param(
  [Parameter(Mandatory)] [string]$Python,
  [Parameter(Mandatory)] [string]$BucketModel,
  [Parameter(Mandatory)] [string[]]$Data,
  [string]$Cache = 'art/out/d8',
  [string]$Out = 'art/out/d8-capacity',
  [ValidateRange(1, 1000)] [int]$Epochs = 50,
  [ValidateRange(0, 0.99)] [double]$Dropout = 0,
  [ValidateRange(0.00000001, 1)] [double]$Lr = 0.001,
  [ValidateRange(1, 540)] [int]$MaxSeconds = 300
)
$ErrorActionPreference = 'Stop'
$sweepRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$sweepEnvNames = @('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS','UV_THREADPOOL_SIZE','PYTHONDONTWRITEBYTECODE','CUDA_CACHE_PATH','TORCH_HOME','RIVER_VALUE_THREADS','RIVER_VALUE_BACKEND','D8_BUCKET_MODEL')
$sweepOldEnv = @{}
foreach ($sweepName in $sweepEnvNames) { $sweepOldEnv[$sweepName] = [Environment]::GetEnvironmentVariable($sweepName, 'Process') }
$sweepProcess = Get-Process -Id $PID
$sweepOldAffinity = $sweepProcess.ProcessorAffinity
Push-Location $sweepRoot
try {
  function Get-SweepOutput([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($sweepRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output/cache must be below this worktree' }
    return $full
  }
  $sweepOut = Get-SweepOutput $Out
  $sweepCache = Get-SweepOutput $Cache
  if ($sweepOut -eq $sweepCache) { throw 'Use a separate sweep output directory' }
  New-Item -ItemType Directory -Path $sweepOut -Force | Out-Null
  foreach ($sweepFile in @('summary.csv','summary.md','summary.json')) {
    $sweepTarget = Join-Path $sweepOut $sweepFile
    if (Test-Path -LiteralPath $sweepTarget) { Remove-Item -LiteralPath $sweepTarget }
  }
  $sweepProcess.ProcessorAffinity = [IntPtr]3
  $env:OMP_NUM_THREADS = '2'
  $env:MKL_NUM_THREADS = '2'
  $env:OPENBLAS_NUM_THREADS = '2'
  $env:UV_THREADPOOL_SIZE = '2'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:CUDA_CACHE_PATH = Join-Path $sweepOut 'cuda-cache'
  $env:TORCH_HOME = Join-Path $sweepOut 'torch-cache'
  $env:RIVER_VALUE_THREADS = '1'
  $env:D8_BUCKET_MODEL = $BucketModel
  $sweepStages = [Collections.Generic.List[object]]::new()
  function Invoke-SweepStep([string]$Name, [string]$Program, [string[]]$Arguments) {
    Write-Host "Running $Name"
    $started = [DateTime]::UtcNow
    $prior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    try { & $Program @Arguments *> (Join-Path $sweepOut "$Name.log"); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($null -eq $code) { $code = 1 }
    $sweepStages.Add([pscustomobject]@{ name=$Name; exitCode=$code; seconds=([DateTime]::UtcNow - $started).TotalSeconds })
    $sweepStages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $sweepOut 'commands.json')
    if ($code -ne 0) { throw "$Name failed, exit $code; see its log in $Out" }
  }
  # Never regenerate a present prepared cache. Validate its sources, then Python
  # verifies every cache/source hash and the frozen split for every fit.
  if (-not (Test-Path -LiteralPath (Join-Path $sweepCache 'cache.json'))) {
    Invoke-SweepStep 'diagnose' $env:ComSpec (@('/c','npx','tsx','apps/server/src/bot-turn-residual-run.ts','diagnose',$sweepCache) + $Data)
    Invoke-SweepStep 'prepare' $env:ComSpec (@('/c','npx','tsx','apps/server/src/bot-turn-residual-run.ts','prepare',$sweepCache) + $Data)
  }
  $sweepSnapshot = Get-Content -Raw (Join-Path $sweepCache 'snapshot.json') | ConvertFrom-Json
  $sweepSources = @($Data | ForEach-Object { Get-ChildItem -LiteralPath $_ -File | Where-Object { $_.Name -match '^turnstart-w\d+-\d+\.bin$' } | ForEach-Object { $_.FullName } } | Sort-Object)
  $sweepFrozen = @($sweepSnapshot.shards | ForEach-Object { [IO.Path]::GetFullPath($_.path) } | Sort-Object)
  if ($sweepSources.Count -eq 0 -or $sweepSources.Count -ne $sweepFrozen.Count -or (Compare-Object $sweepSources $sweepFrozen)) { throw '-Data does not match the prepared snapshot; use a separate -Cache to prepare new data' }
  Invoke-SweepStep 'python-tests' $Python @('-m','unittest','discover','-s','ml','-p','test_turn_residual.py')
  $sweepConfigs = @(
    @{ Name='h16'; Hidden=16; Layers=1; Joint=$false },
    @{ Name='h64x2'; Hidden=64; Layers=2; Joint=$false },
    @{ Name='h128x2'; Hidden=128; Layers=2; Joint=$false },
    @{ Name='h64x2-joint'; Hidden=64; Layers=2; Joint=$true }
  )
  $sweepRows = @()
  $sweepAllResults = @()
  foreach ($sweepConfig in $sweepConfigs) {
    $sweepFitOut = Join-Path $sweepOut $sweepConfig.Name
    New-Item -ItemType Directory -Path $sweepFitOut -Force | Out-Null
    $sweepResults = @()
    foreach ($sweepSeed in @(0,1,2)) {
      $sweepFitArgs = @('ml/train_turn_residual.py','--out',$sweepFitOut,'--cache',$sweepCache,'--model','residual','--seed',"$sweepSeed",'--bucket-model',$BucketModel,'--hidden',"$($sweepConfig.Hidden)",'--layers',"$($sweepConfig.Layers)",'--dropout',$Dropout.ToString([Globalization.CultureInfo]::InvariantCulture),'--epochs',"$Epochs",'--lr',$Lr.ToString([Globalization.CultureInfo]::InvariantCulture),'--max-seconds',"$MaxSeconds",'--require-cuda')
      if ($sweepConfig.Joint) { $sweepFitArgs += '--joint' }
      Invoke-SweepStep "$($sweepConfig.Name)-$sweepSeed-fit" $Python $sweepFitArgs
      $sweepResult = Get-Content -Raw (Join-Path $sweepFitOut "residual-$sweepSeed.result.json") | ConvertFrom-Json
      if (-not $sweepResult.complete -or $sweepResult.epochs -ne $Epochs -or $sweepResult.seed -ne $sweepSeed -or $sweepResult.seconds -ge $MaxSeconds -or $sweepResult.device -ne 'cuda' -or -not $sweepResult.baselineMetrics.all) { throw 'Incomplete fit or CUDA unavailable; no accepted summary' }
      $sweepResults += $sweepResult
      $sweepAllResults += $sweepResult
      Invoke-SweepStep "$($sweepConfig.Name)-$sweepSeed-export" $Python @('ml/export_turn_residual_parity.py','--out',$sweepFitOut,'--cache',$sweepCache,'--seed',"$sweepSeed")
      foreach ($sweepBackend in @('ts','wasm')) {
        $env:RIVER_VALUE_BACKEND = $sweepBackend
        Invoke-SweepStep "$($sweepConfig.Name)-$sweepSeed-parity-$sweepBackend" $env:ComSpec @('/c','npx','tsx','apps/server/src/bot-turn-residual-parity-run.ts',"$sweepFitOut/parity-$sweepSeed.json")
      }
    }
    $sweepTimings = @{}
    foreach ($sweepBackend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND = $sweepBackend
      $sweepTimingPath = Join-Path $sweepFitOut "speed-$sweepBackend.json"
      Invoke-SweepStep "$($sweepConfig.Name)-speed-$sweepBackend" $env:ComSpec @('/c','npx','tsx','apps/server/src/bot-turn-residual-benchmark.ts',"$sweepCache/feature-cases.json","$sweepFitOut/residual-0",$sweepTimingPath)
      $sweepTimings[$sweepBackend] = Get-Content -Raw $sweepTimingPath | ConvertFrom-Json
      if ($sweepTimings[$sweepBackend].backend -ne $sweepBackend -or $sweepTimings[$sweepBackend].threads -ne 1) { throw 'Unexpected inference backend/thread count' }
    }
    $sweepMean = ($sweepResults | ForEach-Object { $_.metrics.all } | Measure-Object -Average).Average
    $sweepBase = ($sweepResults | ForEach-Object { $_.baselineMetrics.all } | Measure-Object -Average).Average
    $sweepVariance = ($sweepResults | ForEach-Object { [Math]::Pow($_.metrics.all - $sweepMean, 2) } | Measure-Object -Sum).Sum / 2
    $sweepFlush = ($sweepResults | ForEach-Object { $_.metrics.'flush-draw' } | Measure-Object -Average).Average
    $sweepFlushBase = ($sweepResults | ForEach-Object { $_.baselineMetrics.'flush-draw' } | Measure-Object -Average).Average
    $sweepRows += [pscustomobject]@{
      config=$sweepConfig.Name; seeds=3; epochs=$Epochs; dropout=$Dropout; lr=$Lr
      baselineMAE=$sweepBase; maeMean=$sweepMean; maeSD=[Math]::Sqrt($sweepVariance)
      improvementPct=100*(1-$sweepMean/$sweepBase); clears20Pct=(100*(1-$sweepMean/$sweepBase) -ge 20)
      flushDrawMAE=$sweepFlush; flushDrawImprovementPct=100*(1-$sweepFlush/$sweepFlushBase)
      fitSecondsMean=($sweepResults | Measure-Object -Property seconds -Average).Average
      tsUsPerSpot=$sweepTimings.ts.residual.meanUs; tsP95Us=$sweepTimings.ts.residual.p95Us
      wasmUsPerSpot=$sweepTimings.wasm.residual.meanUs; wasmP95Us=$sweepTimings.wasm.residual.p95Us
    }
  }
  if (@($sweepAllResults.splitSHA256 | Select-Object -Unique).Count -ne 1 -or @($sweepAllResults.bucketSHA256 | Select-Object -Unique).Count -ne 1) { throw 'Unmatched source bucket model or split' }
  $sweepRows | Export-Csv -NoTypeInformation (Join-Path $sweepOut 'summary.csv')
  [pscustomobject]@{ rows=$sweepRows; fits=$sweepAllResults; speedSeed=0; timingUnit='microseconds per full spot, prepared cards' } | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $sweepOut 'summary.json')
  $sweepMarkdown = @('| Config | MAE mean | MAE SD | Improvement % | Flush improvement % | Fit seconds | TS us/spot | WASM us/spot |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  foreach ($sweepRow in $sweepRows) {
    $sweepMarkdown += ('| {0} | {1:F4} | {2:F4} | {3:F2} | {4:F2} | {5:F1} | {6:F1} | {7:F1} |' -f $sweepRow.config,$sweepRow.maeMean,$sweepRow.maeSD,$sweepRow.improvementPct,$sweepRow.flushDrawImprovementPct,$sweepRow.fitSecondsMean,$sweepRow.tsUsPerSpot,$sweepRow.wasmUsPerSpot)
  }
  $sweepMarkdown | Set-Content (Join-Path $sweepOut 'summary.md')
  $sweepMarkdown | ForEach-Object { Write-Host $_ }
} finally {
  $sweepProcess.ProcessorAffinity = $sweepOldAffinity
  foreach ($sweepName in $sweepEnvNames) { [Environment]::SetEnvironmentVariable($sweepName, $sweepOldEnv[$sweepName], 'Process') }
  Pop-Location
}

param(
  [Parameter(Mandatory)] [string]$Python,
  [Parameter(Mandatory)] [string]$C1Cache,
  [Parameter(Mandatory)] [string]$BucketModel,
  [Parameter(Mandatory)] [string[]]$C2Data,
  [string]$Cache = 'art/out/d8-expanded',
  [string]$Out = 'art/out/d8-data-scale',
  [string]$Part2 = 'art/out/d8-capacity',
  [ValidateRange(1, 1000)] [int]$Epochs = 50,
  [ValidateRange(0.00000001, 1)] [double]$Lr = 0.001,
  [ValidateRange(1, 3600)] [int]$MaxSeconds = 3600
)
$ErrorActionPreference = 'Stop'
$scaleRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$scaleEnvNames = @('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS','UV_THREADPOOL_SIZE','PYTHONDONTWRITEBYTECODE','CUDA_CACHE_PATH','TORCH_HOME','RIVER_VALUE_THREADS','RIVER_VALUE_BACKEND')
$scaleOldEnv = @{}
foreach ($scaleName in $scaleEnvNames) { $scaleOldEnv[$scaleName] = [Environment]::GetEnvironmentVariable($scaleName, 'Process') }
$scaleProcess = Get-Process -Id $PID
$scaleOldAffinity = $scaleProcess.ProcessorAffinity
Push-Location $scaleRoot
try {
  function Get-ScaleOutput([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($scaleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output/cache must be below this worktree' }
    return $full
  }
  function Test-ScaleOverlap([string]$A, [string]$B) {
    return $A -eq $B -or $A.StartsWith($B + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $B.StartsWith($A + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
  }
  $scaleOut = Get-ScaleOutput $Out
  $scaleCache = Get-ScaleOutput $Cache
  $scaleC1 = [IO.Path]::GetFullPath($C1Cache)
  $scaleProtected = @($scaleC1, [IO.Path]::GetFullPath($Part2), (Split-Path ([IO.Path]::GetFullPath($BucketModel)) -Parent)) + @($C2Data | ForEach-Object { [IO.Path]::GetFullPath($_) })
  if (Test-ScaleOverlap $scaleOut $scaleCache) { throw 'Use separate output and cache directories' }
  foreach ($scalePath in $scaleProtected) {
    if ((Test-ScaleOverlap $scaleOut $scalePath) -or (Test-ScaleOverlap $scaleCache $scalePath)) { throw 'Outputs/cache must not overlap source caches, checkpoints or data' }
  }
  New-Item -ItemType Directory -Path $scaleOut -Force | Out-Null
  foreach ($scaleFile in @('summary.csv','summary.md','summary.json','commands.json')) {
    $scaleTarget = Join-Path $scaleOut $scaleFile
    if (Test-Path -LiteralPath $scaleTarget) { Remove-Item -LiteralPath $scaleTarget }
  }
  $scaleProcess.ProcessorAffinity = [IntPtr]3
  $env:OMP_NUM_THREADS = '2'
  $env:MKL_NUM_THREADS = '2'
  $env:OPENBLAS_NUM_THREADS = '2'
  $env:UV_THREADPOOL_SIZE = '2'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:CUDA_CACHE_PATH = Join-Path $scaleOut 'cuda-cache'
  $env:TORCH_HOME = Join-Path $scaleOut 'torch-cache'
  $env:RIVER_VALUE_THREADS = '1'
  $scaleC2Files = @($C2Data | ForEach-Object { Get-ChildItem -LiteralPath $_ -File | Where-Object { $_.Name -match '^turnstart-w\d+-\d+\.bin$' } } | Sort-Object FullName)
  if ($scaleC2Files.Count -eq 0) { throw 'No c2 shards' }
  $scaleSpots = 53550 + ($scaleC2Files | Measure-Object -Property Length -Sum).Sum / 23900
  $scaleRatio = $scaleSpots / 53550
  # Part 2 documentation estimates 120-300 s/fit. Prefer measured h128x2
  # command timings when available. Add 25% for streamed batches and disk I/O.
  $scaleLow = 120.0
  $scaleHigh = 300.0
  $scaleTimingSource = 'part-2 documented 120-300 s/fit estimate (not measured)'
  $scaleCommands = Join-Path $Part2 'commands.json'
  if (Test-Path -LiteralPath $scaleCommands) {
    $scalePrior = @((Get-Content -Raw $scaleCommands | ConvertFrom-Json) | Where-Object { $_.name -match '^h128x2-\d-fit$' -and $_.exitCode -eq 0 })
    if ($scalePrior.Count -gt 0) {
      $scaleLow = ($scalePrior | Measure-Object -Property seconds -Minimum).Minimum
      $scaleHigh = ($scalePrior | Measure-Object -Property seconds -Maximum).Maximum
      $scaleTimingSource = 'measured part-2 h128x2 successful fit wall times'
    }
  }
  $scaleFitLow = $scaleLow * $scaleRatio * 1.25 * [Math]::Max(0.2, $Epochs / 50.0)
  $scaleFitHigh = $scaleHigh * $scaleRatio * 1.25 * [Math]::Max(1.0, $Epochs / 50.0)
  $scalePrepareLow = 300
  $scalePrepareHigh = 900
  if (Test-Path -LiteralPath (Join-Path $scaleCache 'cache.json')) { $scalePrepareLow = 0; $scalePrepareHigh = 0 }
  $scaleEstimate = [pscustomobject]@{
    spots=$scaleSpots; c1TestSpots=5355; c2TestSpots=[Math]::Floor(($scaleSpots-53550)/10)
    source=$scaleTimingSource; dataRatio=$scaleRatio; epochs=$Epochs; fits=9
    preparationMinutes=@(($scalePrepareLow/60),($scalePrepareHigh/60))
    validationMinutesPerFit=@(0.2,1.0)
    baselineMinutesPerSeed=@(($scaleFitLow/60),($scaleFitHigh/60))
    frozenMinutesPerSeed=@(($scaleFitLow/60),($scaleFitHigh/60))
    jointMinutesPerSeed=@(($scaleFitLow/60),($scaleFitHigh/60))
    testsParitySummaryMinutes=@(2,6)
    totalMinutes=@((($scalePrepareLow+9*$scaleFitLow)/60+3.8),(($scalePrepareHigh+9*$scaleFitHigh)/60+15))
    maxSecondsPerFit=$MaxSeconds
    note='Fit estimates include exact c1+c2 scoring. Baseline/joint use the same conservative range; unmeasured. Cache/source verification precedes fit watchdog.'
  }
  $scaleEstimate | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scaleOut 'runtime-estimate.json')
  Write-Host 'Estimated runtime BEFORE starting (minutes):'
  $scaleEstimate | Format-List | Out-Host
  $scaleStages = [Collections.Generic.List[object]]::new()
  function Invoke-ScaleStep([string]$Name, [string]$Program, [string[]]$Arguments) {
    Write-Host "Running $Name"
    $started = [DateTime]::UtcNow
    $prior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    try { & $Program @Arguments *> (Join-Path $scaleOut "$Name.log"); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($null -eq $code) { $code = 1 }
    $scaleStages.Add([pscustomobject]@{ name=$Name; exitCode=$code; seconds=([DateTime]::UtcNow - $started).TotalSeconds })
    $scaleStages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $scaleOut 'commands.json')
    if ($code -ne 0) { throw "$Name failed, exit $code; see its log in $Out" }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $scaleCache 'cache.json'))) {
    Invoke-ScaleStep 'prepare' $env:ComSpec (@('/c','npx','tsx','apps/server/src/bot-turn-residual-expanded-run.ts',$scaleC1,$scaleCache,$BucketModel) + $C2Data)
  }
  # Freeze source membership on reuse; individual byte hashes are checked by Python.
  $scaleSnapshot = Get-Content -Raw (Join-Path $scaleCache 'snapshot.json') | ConvertFrom-Json
  $scaleOldSnapshot = Get-Content -Raw (Join-Path $scaleC1 'snapshot.json') | ConvertFrom-Json
  $scaleHashAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { $scaleOldDigest = ([BitConverter]::ToString($scaleHashAlgorithm.ComputeHash([IO.File]::ReadAllBytes((Join-Path $scaleC1 'snapshot.json'))))).Replace('-','').ToLowerInvariant() }
  finally { $scaleHashAlgorithm.Dispose() }
  if ($scaleSnapshot.historicalSnapshotSHA256 -ne $scaleOldDigest) { throw 'Prepared cache uses another historical c1 snapshot' }
  $scaleExpected = @($scaleOldSnapshot.shards | ForEach-Object { [IO.Path]::GetFullPath($_.path) }) + @($scaleC2Files.FullName)
  $scaleActual = @($scaleSnapshot.shards | ForEach-Object { [IO.Path]::GetFullPath($_.path) })
  if ($scaleExpected.Count -ne $scaleActual.Count -or (Compare-Object $scaleExpected $scaleActual)) { throw 'Prepared source membership differs from c1 snapshot + C2Data; use a NEW cache' }
  Invoke-ScaleStep 'python-tests' $Python @('-m','unittest','discover','-s','ml','-p','test_turn_residual*.py')
  foreach ($scaleSeed in @(0,1,2)) {
    foreach ($scaleConfig in @('baseline','frozen','joint')) {
      $scaleModel = 'residual'
      $scaleSource = Join-Path $scaleOut "baseline/baseline-$scaleSeed-bucket"
      if ($scaleConfig -eq 'baseline') { $scaleModel = 'baseline'; $scaleSource = $BucketModel }
      $scaleFitOut = Join-Path $scaleOut $scaleConfig
      $scaleArgs = @('ml/train_turn_residual_expanded.py','--out',$scaleFitOut,'--cache',$scaleCache,'--model',$scaleModel,'--seed',"$scaleSeed",'--bucket-model',$scaleSource,'--epochs',"$Epochs",'--lr',$Lr.ToString([Globalization.CultureInfo]::InvariantCulture),'--max-seconds',"$MaxSeconds",'--require-cuda')
      if ($scaleConfig -eq 'joint') { $scaleArgs += '--joint' }
      Invoke-ScaleStep "$scaleConfig-$scaleSeed-fit" $Python $scaleArgs
      $scaleResult = Get-Content -Raw (Join-Path $scaleFitOut "$scaleModel-$scaleSeed.result.json") | ConvertFrom-Json
      if (-not $scaleResult.complete -or $scaleResult.epochs -ne $Epochs -or $scaleResult.seed -ne $scaleSeed -or $scaleResult.seconds -ge $MaxSeconds -or $scaleResult.device -ne 'cuda' -or $scaleResult.tests.c1.spots -ne 5355 -or $scaleResult.tests.c2.spots -ne $scaleEstimate.c2TestSpots) { throw 'Incomplete/unmatched fit; no accepted summary' }
      if ($scaleConfig -ne 'baseline') {
        Invoke-ScaleStep "$scaleConfig-$scaleSeed-export" $Python @('ml/export_turn_residual_parity.py','--out',$scaleFitOut,'--cache',$scaleCache,'--seed',"$scaleSeed")
        foreach ($scaleBackend in @('ts','wasm')) {
          $env:RIVER_VALUE_BACKEND = $scaleBackend
          Invoke-ScaleStep "$scaleConfig-$scaleSeed-parity-$scaleBackend" $env:ComSpec @('/c','npx','tsx','apps/server/src/bot-turn-residual-parity-run.ts',"$scaleFitOut/parity-$scaleSeed.json")
        }
      }
    }
  }
  Invoke-ScaleStep 'summary' $Python @('ml/summarise_turn_residual_expanded.py','--out',$scaleOut,'--epochs',"$Epochs",'--max-seconds',"$MaxSeconds")
  Get-Content (Join-Path $scaleOut 'summary.md') | ForEach-Object { Write-Host $_ }
} finally {
  $scaleProcess.ProcessorAffinity = $scaleOldAffinity
  foreach ($scaleName in $scaleEnvNames) { [Environment]::SetEnvironmentVariable($scaleName, $scaleOldEnv[$scaleName], 'Process') }
  Pop-Location
}

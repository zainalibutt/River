param(
  [string]$Python,
  [string]$Cache = 'art/out/d8-expanded',
  [string]$Teacher = 'art/out/d8-data-scale/frozen/residual-0',
  [string]$Part3 = 'art/out/d8-data-scale',
  [string]$Packed = 'art/out/d8-distill-packed',
  [string]$Out = 'art/out/d8-distill',
  [switch]$EstimateOnly
)
$ErrorActionPreference = 'Stop'
$distillRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$distillClock = [Diagnostics.Stopwatch]::StartNew()
function Resolve-DistillPath([string]$Path) {
  if (-not [IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $distillRoot $Path }
  [IO.Path]::GetFullPath($Path)
}
function Test-DistillOverlap([string]$A, [string]$B) {
  $A -eq $B -or $A.StartsWith($B + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $B.StartsWith($A + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
$Cache = Resolve-DistillPath $Cache
$Teacher = Resolve-DistillPath $Teacher
$Part3 = Resolve-DistillPath $Part3
$Packed = Resolve-DistillPath $Packed
$Out = Resolve-DistillPath $Out
foreach ($distillOutput in @($Out,$Packed)) {
  if (-not $distillOutput.StartsWith($distillRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'All outputs must be below this worktree' }
  foreach ($distillProtected in @($Cache,$Part3,(Split-Path $Teacher -Parent))) {
    if (Test-DistillOverlap $distillOutput $distillProtected) { throw 'Outputs must not overlap input caches/models' }
  }
}
if (Test-DistillOverlap $Out $Packed) { throw 'Use separate run and packed directories' }
$distillPrior = Get-Content -Raw (Join-Path $Part3 'commands.json') | ConvertFrom-Json
$distillFits = @($distillPrior | Where-Object { $_.name -match '^frozen-\d-fit$' -and $_.exitCode -eq 0 })
if ($distillFits.Count -ne 3) { throw 'Need three successful measured part-3 frozen fits' }
$distillResults = @(0,1,2 | ForEach-Object { Get-Content -Raw (Join-Path $Part3 "frozen/residual-$_.result.json") | ConvertFrom-Json })
if (@($distillResults | Where-Object { -not $_.complete -or $_.epochs -ne 50 -or $_.device -ne 'cuda' }).Count) { throw 'Incomplete part-3 measurements' }
$distillMeta = Get-Content -Raw (Join-Path $Cache 'cache.json') | ConvertFrom-Json
$distillSplit = Get-Content -Raw (Join-Path $Cache 'split.json') | ConvertFrom-Json
$distillPackSeconds = ($distillPrior | Where-Object { $_.name -eq 'prepare' -and $_.exitCode -eq 0 } | Measure-Object seconds -Maximum).Maximum
if (-not $distillPackSeconds) { throw 'Need measured part-3 prepare timing' }
if (Test-Path -LiteralPath (Join-Path $Packed 'packed.json')) {
  $distillPackedMeta=Get-Content -Raw (Join-Path $Packed 'packed.json') | ConvertFrom-Json
  if (-not $distillPackedMeta.complete) { throw 'Partial/probe packed cache cannot be reused' }
  $distillPackSeconds = 0
}
$distillRowRatio = 1128.0 / (16*50)
$distillFitSeconds = ($distillResults | Measure-Object fitSeconds -Maximum).Maximum * $distillRowRatio * 1.25
$distillScoreSeconds = ($distillResults | Measure-Object evaluationSeconds -Maximum).Maximum
$distillEstimate = [pscustomobject]@{
  source='measured part-3 fit/evaluation/prepare; all-holding row ratio plus 25 percent teacher/I/O allowance (projection, not a measured student run)'
  spots=$distillMeta.spots; fits=5; passes=16; coverageRowsPerFit=($distillSplit.training.Count*2*1128)
  packedGB=($distillMeta.spots*(1128*34+295)*4/1e9)
  preparationMinutes=($distillPackSeconds/60)
  fitMinutesPerSeed=($distillFitSeconds/60); scoringMinutesPerSeed=($distillScoreSeconds/60)
  testsParityProfilesMinutes=6; hashAndIOAllowanceMinutes=5
  totalMinutes=(($distillPackSeconds+5*($distillFitSeconds+$distillScoreSeconds))/60+11)
  hardTotalMinutes=75
  note='Reuses d8-expanded unchanged. Supplemental factorised all-holding pack only. Fixed teacher seed 0 for every student. Best architecture selected by calibration, never test scores. Actual 75-minute deadline includes every stage.'
}
Write-Host 'Runtime estimate BEFORE execution:'
$distillEstimate | Format-List | Out-Host
if ($EstimateOnly) { return }
if ($distillEstimate.totalMinutes -ge 75) { throw 'Projected total exceeds 75 minutes; refusing to start' }
if (-not $Python) { throw 'Supply -Python with the CUDA PyTorch interpreter' }
$Python = (Get-Command $Python -ErrorAction Stop).Source
if (Test-Path -LiteralPath $Out) { throw 'Use a new run directory; previous results are preserved' }
if ((Test-Path -LiteralPath $Packed) -and -not (Test-Path -LiteralPath (Join-Path $Packed 'packed.json'))) { throw 'Partial packed cache; use a new directory' }
$distillDrive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Packed))
if ($distillPackSeconds -gt 0 -and $distillDrive.AvailableFreeSpace -lt ($distillEstimate.packedGB+4)*1e9) { throw 'Insufficient free space for all-holding pack' }
$distillEnvNames = @('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS','UV_THREADPOOL_SIZE','PYTHONDONTWRITEBYTECODE','CUDA_CACHE_PATH','TORCH_HOME','RIVER_VALUE_THREADS','RIVER_VALUE_BACKEND','TMP','TEMP')
$distillOldEnv = @{}
foreach ($distillName in $distillEnvNames) { $distillOldEnv[$distillName] = [Environment]::GetEnvironmentVariable($distillName,'Process') }
$distillProcess = Get-Process -Id $PID
$distillAffinity = $distillProcess.ProcessorAffinity
Push-Location $distillRoot
try {
  New-Item -ItemType Directory -Path $Out | Out-Null
  $distillEstimate | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'runtime-estimate.json')
  $distillProcess.ProcessorAffinity = [IntPtr]3
  $env:OMP_NUM_THREADS='2'; $env:MKL_NUM_THREADS='2'; $env:OPENBLAS_NUM_THREADS='2'; $env:UV_THREADPOOL_SIZE='2'
  $env:PYTHONDONTWRITEBYTECODE='1'; $env:RIVER_VALUE_THREADS='1'
  $env:CUDA_CACHE_PATH=Join-Path $Out 'cuda-cache'; $env:TORCH_HOME=Join-Path $Out 'torch-cache'
  $env:TMP=Join-Path $Out 'tmp'; $env:TEMP=$env:TMP
  New-Item -ItemType Directory -Path $env:TMP -Force | Out-Null
  $distillNode = (Get-Command node).Source
  $distillTsx = Join-Path $distillRoot 'node_modules/tsx/dist/cli.mjs'
  $distillStages = [Collections.Generic.List[object]]::new()
  function Quote-DistillArgument([string]$Value) {
    '"' + ([regex]::Replace(([regex]::Replace($Value, '(\\*)"', '$1$1\"')), '(\\+)$', '$1$1')) + '"'
  }
  function Invoke-DistillStep([string]$Name, [string]$Program, [string[]]$Arguments) {
    if ($distillClock.Elapsed.TotalSeconds -ge 4500) { throw '75-minute deadline exhausted before stage' }
    Write-Host "Running $Name (elapsed $([Math]::Round($distillClock.Elapsed.TotalMinutes,1)) min)"
    $distillInfo = [Diagnostics.ProcessStartInfo]::new()
    $distillInfo.FileName = $Program
    $distillInfo.Arguments = ($Arguments | ForEach-Object { Quote-DistillArgument $_ }) -join ' '
    $distillInfo.WorkingDirectory = $distillRoot
    $distillInfo.UseShellExecute=$false; $distillInfo.CreateNoWindow=$true
    $distillInfo.RedirectStandardOutput=$true; $distillInfo.RedirectStandardError=$true
    $distillChild = [Diagnostics.Process]::Start($distillInfo)
    $distillStdout = $distillChild.StandardOutput.ReadToEndAsync()
    $distillStderr = $distillChild.StandardError.ReadToEndAsync()
    $distillStageClock = [Diagnostics.Stopwatch]::StartNew()
    $distillTimedOut = $false
    while (-not $distillChild.WaitForExit(250)) {
      if ($distillClock.Elapsed.TotalSeconds -ge 4500) {
        & taskkill.exe /PID $distillChild.Id /T /F | Out-Null
        $distillTimedOut=$true
        break
      }
    }
    $distillChild.WaitForExit()
    $distillStdout.Result | Set-Content (Join-Path $Out "$Name.log")
    $distillStderr.Result | Set-Content (Join-Path $Out "$Name.stderr.log")
    $distillCode=$distillChild.ExitCode
    if ($distillTimedOut) { $distillCode=124 }
    $distillStages.Add([pscustomobject]@{name=$Name;exitCode=$distillCode;seconds=$distillStageClock.Elapsed.TotalSeconds})
    $distillStages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'commands.json')
    $distillChild.Dispose()
    if ($distillCode -ne 0) { throw "$Name failed with exit $distillCode; see logs. No accepted result." }
  }
  Invoke-DistillStep 'python-tests' $Python @('-m','unittest','discover','-s','ml','-p','test_turn_residual*.py')
  if (-not (Test-Path -LiteralPath (Join-Path $Packed 'packed.json'))) {
    $env:RIVER_VALUE_BACKEND='wasm'
    Invoke-DistillStep 'pack-all-holdings' $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-distill-prepare.ts',$Cache,$Packed,$Teacher)
  }
  function Invoke-DistillProfile([string]$Name, [string]$Stem) {
    foreach ($distillBackend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND=$distillBackend
      Invoke-DistillStep "$Name-profile-$distillBackend" $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-benchmark.ts',(Join-Path $Cache 'feature-cases.json'),$Stem,(Join-Path $Out "$Name-$distillBackend.json"))
    }
  }
  Invoke-DistillProfile 'teacher' $Teacher
  function Invoke-DistillFit([string]$Config, [int]$Seed) {
    $distillWidth=16; $distillLayers=1
    if ($Config -ne 'h16') { $distillWidth=32 }
    if ($Config -eq 'h32x2') { $distillLayers=2 }
    $distillFitOut=Join-Path $Out $Config
    Invoke-DistillStep "$Config-$Seed-fit" $Python @('ml/train_turn_residual_distill.py','--out',$distillFitOut,'--cache',$Cache,'--packed',$Packed,'--teacher',$Teacher,'--hidden',"$distillWidth",'--layers',"$distillLayers",'--seed',"$Seed")
    Invoke-DistillStep "$Config-$Seed-export" $Python @('ml/export_turn_residual_parity.py','--out',$distillFitOut,'--cache',$Cache,'--seed',"$Seed")
    foreach ($distillBackend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND=$distillBackend
      Invoke-DistillStep "$Config-$Seed-parity-$distillBackend" $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-parity-run.ts',(Join-Path $distillFitOut "parity-$Seed.json"))
    }
    Invoke-DistillProfile "$Config-$Seed" (Join-Path $distillFitOut "residual-$Seed")
  }
  foreach ($distillConfig in @('h16','h32','h32x2')) { Invoke-DistillFit $distillConfig 0 }
  $distillCandidates = @(foreach ($distillConfig in @('h16','h32','h32x2')) {
    $distillResult=Get-Content -Raw (Join-Path $Out "$distillConfig/residual-0.result.json") | ConvertFrom-Json
    $distillSpeed=Get-Content -Raw (Join-Path $Out "$distillConfig-0-wasm.json") | ConvertFrom-Json
    [pscustomobject]@{config=$distillConfig;calibrationWorst=[Math]::Max($distillResult.calibration.c1.all,$distillResult.calibration.c2.all);wasmMedianUs=$distillSpeed.residual.medianUs;slow=[int]($distillSpeed.residual.medianUs -gt 2000)}
  })
  $distillBest=($distillCandidates | Sort-Object slow,calibrationWorst,wasmMedianUs | Select-Object -First 1).config
  [pscustomobject]@{best=$distillBest;rule='Prefer WASM median <=2ms, then minimum worst-cohort calibration MAE; no test selection';candidates=$distillCandidates} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'selection.json')
  foreach ($distillSeed in @(1,2)) { Invoke-DistillFit $distillBest $distillSeed }
  Invoke-DistillStep 'summary' $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-distill-summary.ts',$Out,$Teacher,$Packed)
  if ($distillClock.Elapsed.TotalMinutes -ge 75) { throw 'Total deadline exceeded; no accepted result' }
  [pscustomobject]@{complete=$true;seconds=$distillClock.Elapsed.TotalSeconds;best=$distillBest} | ConvertTo-Json | Set-Content (Join-Path $Out 'complete.json')
  Get-Content (Join-Path $Out 'summary.md') | ForEach-Object { Write-Host $_ }
} finally {
  $distillProcess.ProcessorAffinity=$distillAffinity
  foreach ($distillName in $distillEnvNames) { [Environment]::SetEnvironmentVariable($distillName,$distillOldEnv[$distillName],'Process') }
  Pop-Location
}

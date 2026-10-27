param(
  [string]$Python,
  [string]$Cache = 'art/out/d8-expanded',
  [string]$Teacher = 'art/out/d8-data-scale/frozen/residual-0',
  [string]$Part3 = 'art/out/d8-data-scale',
  [string]$Packed = 'art/out/d8-distill-packed',
  [string]$Out = 'art/out/d8-distill',
  [switch]$EstimateOnly,
  [switch]$Smoke
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
} else { throw 'Existing complete all-holding pack required; this runner never rebuilds it' }
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
  note='Legacy part-3 projection is advisory. Run -Smoke for measured fast-feed timing. No total-runtime cap. Reuse the existing all-holding pack. Fixed teacher seed 0; selection uses calibration only.'
}
Write-Host 'Legacy part-3 estimate (advisory; use -Smoke for the new feed):'
$distillEstimate | Format-List | Out-Host
if ($EstimateOnly) { return }
if (-not $Python) { throw 'Supply -Python with the CUDA PyTorch interpreter' }
$Python = (Get-Command $Python -ErrorAction Stop).Source
if ((Test-Path -LiteralPath $Packed) -and -not (Test-Path -LiteralPath (Join-Path $Packed 'packed.json'))) { throw 'Partial packed cache; use a new directory' }
$distillEnvNames = @('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS','UV_THREADPOOL_SIZE','PYTHONDONTWRITEBYTECODE','CUDA_CACHE_PATH','TORCH_HOME','RIVER_VALUE_THREADS','RIVER_VALUE_BACKEND','TMP','TEMP')
$distillOldEnv = @{}
foreach ($distillName in $distillEnvNames) { $distillOldEnv[$distillName] = [Environment]::GetEnvironmentVariable($distillName,'Process') }
$distillProcess = Get-Process -Id $PID
$distillAffinity = $distillProcess.ProcessorAffinity
Push-Location $distillRoot
try {
  New-Item -ItemType Directory -Path $Out -Force | Out-Null
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
  if (Test-Path (Join-Path $Out 'commands.json')) {
    foreach ($entry in @(Get-Content -Raw (Join-Path $Out 'commands.json') | ConvertFrom-Json)) {
      if ($entry.exitCode -eq 0) { $distillStages.Add($entry) }
    }
  }
  $distillReceiptDir = Join-Path $Out 'stages'
  New-Item -ItemType Directory -Path $distillReceiptDir -Force | Out-Null
  # Bind resumptions to source, input metadata and teacher bytes, not machine paths.
  $distillInputFiles = @('ml/d8_distill.ps1')
  $distillInputFiles += @(Get-ChildItem (Join-Path $distillRoot 'ml') -Filter '*.py' -File | Sort-Object Name | Select-Object -ExpandProperty FullName)
  $distillInputFiles += @(Get-ChildItem (Join-Path $distillRoot 'apps/server/src') -Filter 'bot-*' -File | Sort-Object Name | Select-Object -ExpandProperty FullName)
  $distillInputFiles += @((Join-Path $Cache 'cache.json'),(Join-Path $Cache 'split.json'),(Join-Path $Cache 'feature-cases.json'),(Join-Path $Packed 'packed.json'))
  $distillInputFiles += @('.json','-bucket.json','-bucket.bin','-head.json','-head.bin' | ForEach-Object { "$Teacher$_" })
  # packed.json must already exist: this runner reuses the expensive pack.
  $distillInputKey = (@($distillInputFiles | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }) -join ':')
  function Quote-DistillArgument([string]$Value) {
    '"' + ([regex]::Replace(([regex]::Replace($Value, '(\\*)"', '$1$1\"')), '(\\+)$', '$1$1')) + '"'
  }
  function Invoke-DistillStep([string]$Name, [string]$Program, [string[]]$Arguments, [string[]]$Files = @(), [scriptblock]$Validate = { $true }, [string[]]$Dependencies = @()) {
    $receiptPath = Join-Path $distillReceiptDir "$Name.json"
    $stageKey = $distillInputKey + ':' + ($Arguments -join '|') + ':' + $env:RIVER_VALUE_BACKEND
    foreach ($dependency in $Dependencies) { $stageKey += ':' + (Get-FileHash -LiteralPath $dependency -Algorithm SHA256).Hash }
    $skip = $false
    try {
      if (Test-Path -LiteralPath $receiptPath) {
        $receipt = Get-Content -Raw $receiptPath | ConvertFrom-Json
        $skip = $receipt.complete -eq $true -and $receipt.key -eq $stageKey
        if ($skip) {
          foreach ($artifact in $receipt.artifacts) {
            $artifactPath = Join-Path $distillRoot $artifact.file
            if (-not (Test-Path -LiteralPath $artifactPath) -or (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash -ne $artifact.sha256) { $skip = $false; break }
          }
          if ($skip) { $skip = [bool](& $Validate) }
        }
      }
    } catch { $skip = $false }
    for ($i=$distillStages.Count-1; $i -ge 0; $i--) { if ($distillStages[$i].name -eq $Name) { $distillStages.RemoveAt($i) } }
    if ($skip) {
      Write-Host "Skipping valid $Name (elapsed $([Math]::Round($distillClock.Elapsed.TotalMinutes,1)) min)"
      $distillStages.Add([pscustomobject]@{name=$Name;exitCode=0;seconds=$receipt.seconds;skipped=$true})
      $distillStages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'commands.json')
      return
    }
    # Invalidate completion before rerunning a changed or incomplete stage.
    Remove-Item -LiteralPath (Join-Path $Out 'complete.json') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $receiptPath -Force -ErrorAction SilentlyContinue
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
    $distillNextLog = 30
    while (-not $distillChild.WaitForExit(250)) {
      if ($distillStageClock.Elapsed.TotalSeconds -ge $distillNextLog) {
        Write-Host "$Name running: stage $([Math]::Round($distillStageClock.Elapsed.TotalMinutes,1)) min; total $([Math]::Round($distillClock.Elapsed.TotalMinutes,1)) min"
        $distillNextLog += 30
      }
    }
    $distillChild.WaitForExit()
    $distillStdout.Result | Set-Content (Join-Path $Out "$Name.log")
    $distillStderr.Result | Set-Content (Join-Path $Out "$Name.stderr.log")
    $distillCode=$distillChild.ExitCode
    $distillStages.Add([pscustomobject]@{name=$Name;exitCode=$distillCode;seconds=$distillStageClock.Elapsed.TotalSeconds})
    $distillStages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'commands.json')
    $distillChild.Dispose()
    if ($distillCode -ne 0) { throw "$Name failed with exit $distillCode; see logs. No accepted result." }
    if (-not (& $Validate)) { throw "$Name produced an invalid result" }
    $artifacts = @(foreach ($file in @($Files) + @((Join-Path $Out "$Name.log"))) {
      if (-not (Test-Path -LiteralPath $file)) { throw "$Name missing artifact $file" }
      if ($Files -contains $file -and (Get-Item -LiteralPath $file).Length -eq 0) { throw "$Name empty artifact $file" }
      [pscustomobject]@{file=$file.Substring($distillRoot.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
    })
    [pscustomobject]@{complete=$true;key=$stageKey;seconds=$distillStageClock.Elapsed.TotalSeconds;artifacts=$artifacts} | ConvertTo-Json -Depth 5 | Set-Content $receiptPath
    Write-Host "Finished ${Name}: stage $([Math]::Round($distillStageClock.Elapsed.TotalMinutes,1)) min; total $([Math]::Round($distillClock.Elapsed.TotalMinutes,1)) min"
  }
  Invoke-DistillStep 'python-tests' $Python @('-m','unittest','discover','-s','ml','-p','test_turn_residual*.py')
  Write-Host 'Reusing existing all-holding pack; no pack rebuild.'
  if ($Smoke) {
    $smokeOut = Join-Path $Out 'smoke-h16'
    $smokeFile = Join-Path $smokeOut 'smoke.json'
    Invoke-DistillStep 'smoke-h16-fit' $Python @('ml/train_turn_residual_distill.py','--out',$smokeOut,'--cache',$Cache,'--packed',$Packed,'--teacher',$Teacher,'--hidden','16','--layers','1','--seed','0','--smoke') @($smokeFile) {
      $s = Get-Content -Raw $smokeFile | ConvertFrom-Json
      $s.complete -and $s.smoke -and $s.passes -eq 1 -and $s.planPasses -eq 16 -and $s.secondsPerPass -gt 0
    }
    $s = Get-Content -Raw $smokeFile | ConvertFrom-Json
    $base = $s.setupSeconds + $s.chunkLoadSeconds + $s.cachedTargetReadSeconds
    $student = $s.warmH16FitSeconds - $base
    $deepRatio = (65*32+32*32+32) / (65*16+16)
    $projection = [pscustomobject]@{
      measuredStudentSecondsPerPass=$s.secondsPerPass; measuredPassIncludingSetupAndTargetsSeconds=$s.seconds
      teacherTargetPreparationSeconds=$s.teacherTargetSeconds; newTeacherChunks=$s.newTeacherChunks
      projectedWarmH16FitMinutes=($s.warmH16FitSeconds/60)
      projectedFullPlanMinutes=((5*$base + $student*(1+2+3*$deepRatio) + 5*$distillScoreSeconds)/60+11)
      basis='Measured h16 stripe and chunk loads; h32/deep student costs scaled by dense multiply counts, assuming widest architecture wins two extra seeds. Scoring uses measured part-3 timing; tests/parity/profile allowance 11 min. Teacher targets prepared by smoke are reused. Advisory projection, no deadline.'
    }
    $projection | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'smoke-projection.json')
    $projection | Format-List | Out-Host
    return
  }
  function Invoke-DistillProfile([string]$Name, [string]$Stem) {
    foreach ($distillBackend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND=$distillBackend
      $profileFile = Join-Path $Out "$Name-$distillBackend.json"
      $profileInputs = @('.json','-bucket.json','-bucket.bin','-head.json','-head.bin' | ForEach-Object { "$Stem$_" })
      Invoke-DistillStep "$Name-profile-$distillBackend" $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-benchmark.ts',(Join-Path $Cache 'feature-cases.json'),$Stem,$profileFile) @($profileFile) {
        $p = Get-Content -Raw $profileFile | ConvertFrom-Json
        $p.trainedResidual -and $p.backend -eq $distillBackend -and $p.threads -le 2 -and $p.residual.medianUs -gt 0
      } $profileInputs
    }
  }
  Invoke-DistillProfile 'teacher' $Teacher
  function Invoke-DistillFit([string]$Config, [int]$Seed) {
    $distillWidth=16; $distillLayers=1
    if ($Config -ne 'h16') { $distillWidth=32 }
    if ($Config -eq 'h32x2') { $distillLayers=2 }
    $distillFitOut=Join-Path $Out $Config
    $fitStem = Join-Path $distillFitOut "residual-$Seed"
    $fitFiles = @('.result.json','.json','-bucket.json','-bucket.bin','-head.json','-head.bin' | ForEach-Object { "$fitStem$_" })
    Invoke-DistillStep "$Config-$Seed-fit" $Python @('ml/train_turn_residual_distill.py','--out',$distillFitOut,'--cache',$Cache,'--packed',$Packed,'--teacher',$Teacher,'--hidden',"$distillWidth",'--layers',"$distillLayers",'--seed',"$Seed") $fitFiles {
      $r = Get-Content -Raw "$fitStem.result.json" | ConvertFrom-Json
      $r.complete -and $r.feedVersion -eq 2 -and $r.device -eq 'cuda' -and $r.passes -eq 16 -and $r.seed -eq $Seed -and $r.hidden -eq $distillWidth -and $r.layers -eq $distillLayers -and $r.coverageRows -eq $r.expectedRows -and $r.expectedRows -eq ($distillSplit.training.Count*2*1128) -and $r.teacherSHA256 -eq $distillPackedMeta.teacherSHA256 -and $r.splitSHA256 -eq $distillPackedMeta.splitSHA256 -and $r.snapshotSHA256 -eq $distillPackedMeta.snapshotSHA256
    }
    $parityFile = Join-Path $distillFitOut "parity-$Seed.json"
    Invoke-DistillStep "$Config-$Seed-export" $Python @('ml/export_turn_residual_parity.py','--out',$distillFitOut,'--cache',$Cache,'--seed',"$Seed") @($parityFile) {
      $p = Get-Content -Raw $parityFile | ConvertFrom-Json
      $p.cases.Count -ge 5 -and $p.featureParityMax -le 1e-5
    } $fitFiles
    foreach ($distillBackend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND=$distillBackend
      Invoke-DistillStep "$Config-$Seed-parity-$distillBackend" $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-parity-run.ts',$parityFile) @() {
        $p = Get-Content -Raw (Join-Path $Out "$Config-$Seed-parity-$distillBackend.log") | ConvertFrom-Json
        $p.backend -eq $distillBackend -and $p.cases -ge 5 -and $p.featureMax -le 1e-5 -and $p.outputMax -le 1e-5
      } @($parityFile)
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
  $summaryInputs = @((Join-Path $Out 'selection.json'))
  $summaryInputs += @(Get-ChildItem $distillReceiptDir -Filter '*.json' | Where-Object { $_.BaseName -ne 'summary' } | Sort-Object Name | Select-Object -ExpandProperty FullName)
  Invoke-DistillStep 'summary' $distillNode @($distillTsx,'apps/server/src/bot-turn-residual-distill-summary.ts',$Out,$Teacher,$Packed) @((Join-Path $Out 'summary.json'),(Join-Path $Out 'summary.csv'),(Join-Path $Out 'summary.md')) { $true } $summaryInputs
  [pscustomobject]@{complete=$true;seconds=$distillClock.Elapsed.TotalSeconds;best=$distillBest} | ConvertTo-Json | Set-Content (Join-Path $Out 'complete.json')
  Get-Content (Join-Path $Out 'summary.md') | ForEach-Object { Write-Host $_ }
} finally {
  $distillProcess.ProcessorAffinity=$distillAffinity
  foreach ($distillName in $distillEnvNames) { [Environment]::SetEnvironmentVariable($distillName,$distillOldEnv[$distillName],'Process') }
  Pop-Location
}

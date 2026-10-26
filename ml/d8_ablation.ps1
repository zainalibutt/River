param(
  [string]$Python = '<venv>\Scripts\python.exe',
  [string]$Out = 'art/out/d8',
  [string]$BucketModel = '<models>/turnstart-c1-53k-e50/river-buckets-128',
  [string[]]$Data = @('<data>/turnstart-c1-pc3', '<data>/turnstart-c1-pc2', '<data>/turnstart-c1-pc1'),
  [switch]$Prepared
)
$ErrorActionPreference = 'Stop'
$d8Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
Push-Location $d8Root
try {
  $d8Out = [IO.Path]::GetFullPath($Out)
  if (-not $d8Out.StartsWith($d8Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be below this worktree' }
  New-Item -ItemType Directory -Path $d8Out -Force | Out-Null
  (Get-Process -Id $PID).ProcessorAffinity = [IntPtr]3
  $env:OMP_NUM_THREADS = '2'
  $env:MKL_NUM_THREADS = '2'
  $env:OPENBLAS_NUM_THREADS = '2'
  $env:UV_THREADPOOL_SIZE = '2'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:CUDA_CACHE_PATH = Join-Path $d8Out 'cuda-cache'
  $env:TORCH_HOME = Join-Path $d8Out 'torch-cache'
  $env:RIVER_VALUE_THREADS = '1'
  $env:D8_BUCKET_MODEL = $BucketModel
  $d8Stages = [Collections.Generic.List[object]]::new()
  function Invoke-D8Step([string]$Name, [string]$Program, [string[]]$Arguments) {
    $d8Started = [DateTime]::UtcNow
    $d8PriorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Program @Arguments *> (Join-Path $d8Out "$Name.log") }
    finally { $ErrorActionPreference = $d8PriorPreference }
    $d8Code = $LASTEXITCODE
    $d8Stages.Add([pscustomobject]@{ name=$Name; program=$Program; arguments=$Arguments; exitCode=$d8Code; seconds=([DateTime]::UtcNow - $d8Started).TotalSeconds })
    $d8Stages | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $d8Out 'commands.json')
    if ($d8Code -ne 0) { throw "$Name failed, exit $d8Code; see $d8Out/$Name.log" }
  }
  if (-not $Prepared) {
    Invoke-D8Step 'diagnose' $env:ComSpec (@('/c','npx','tsx','apps/server/src/bot-turn-residual-run.ts','diagnose',$d8Out) + $Data)
    Invoke-D8Step 'prepare' $env:ComSpec (@('/c','npx','tsx','apps/server/src/bot-turn-residual-run.ts','prepare',$d8Out) + $Data)
  }
  Invoke-D8Step 'python-probe' $Python @('--version')
  Invoke-D8Step 'python-tests' $Python @('-m','unittest','discover','-s','ml','-p','test_turn_residual.py')
  foreach ($d8Seed in @(0,1,2)) {
    foreach ($d8Model in @('baseline','residual')) {
      Invoke-D8Step "$d8Model-$d8Seed" $Python @('ml/train_turn_residual.py','--out',$d8Out,'--model',$d8Model,'--seed',"$d8Seed")
    }
    Invoke-D8Step "export-parity-$d8Seed" $Python @('ml/export_turn_residual_parity.py','--out',$d8Out,'--seed',"$d8Seed")
    foreach ($d8Backend in @('ts','wasm')) {
      $env:RIVER_VALUE_BACKEND = $d8Backend
      Invoke-D8Step "parity-$d8Seed-$d8Backend" $env:ComSpec @('/c','npx','tsx','apps/server/src/bot-turn-residual-parity-run.ts',"$d8Out/parity-$d8Seed.json")
    }
  }
  $env:RIVER_VALUE_BACKEND = 'wasm'
  Invoke-D8Step 'benchmark' $env:ComSpec @('/c','npx','tsx','apps/server/src/bot-turn-residual-benchmark.ts',"$d8Out/feature-cases.json","$d8Out/residual-0")
  Invoke-D8Step 'summary' $Python @('ml/train_turn_residual.py','--out',$d8Out,'--summary')
} finally { Pop-Location }

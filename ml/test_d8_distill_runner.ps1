# No Python. Exercise the actual runner's Windows argument quoting, logs and deadline.
$ErrorActionPreference='Stop'
$distillRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$distillErrors=$null
$distillAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'd8_distill.ps1'),[ref]$null,[ref]$distillErrors)
if ($distillErrors) { throw 'Runner parse failed' }
foreach ($distillFunction in @('Quote-DistillArgument','Invoke-DistillStep')) {
  $distillDefinition=$distillAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $distillFunction},$true)
  . ([scriptblock]::Create($distillDefinition.Extent.Text))
}
$Out=Join-Path $distillRoot ('art/out/d8-runner-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$distillClock=[Diagnostics.Stopwatch]::StartNew()
$distillStages=[Collections.Generic.List[object]]::new()
$distillNode=(Get-Command node).Source
$distillExpected=@('with spaces','a"quoted"value','trailing slash\','plain')
Invoke-DistillStep 'arguments' $distillNode (@('-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--')+$distillExpected)
$distillActual=Get-Content -Raw (Join-Path $Out 'arguments.log') | ConvertFrom-Json
if (Compare-Object $distillExpected $distillActual -SyncWindow 0) { throw 'Windows argument roundtrip failed' }
if ($distillStages.Count -ne 1 -or $distillStages[0].exitCode -ne 0) { throw 'Successful exit was not recorded' }
$distillFailed=$false
try { Invoke-DistillStep 'failure' $distillNode @('-e','process.exit(7)') } catch { $distillFailed=$true }
if (-not $distillFailed -or $distillStages[1].exitCode -ne 7) { throw 'Failure was not propagated' }
$distillClock=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalSeconds=4501;TotalMinutes=75.01}}
$distillStopped=$false
try { Invoke-DistillStep 'must-not-start' $distillNode @('-e','process.exit(0)') } catch { $distillStopped=$true }
if (-not $distillStopped -or $distillStages.Count -ne 2) { throw 'Deadline did not prevent child launch' }
Write-Host 'Runner parse, argument roundtrip, exit logging and deadline checks passed.'

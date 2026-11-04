# No Python. Exercise actual runner quoting, logging, validated resume and no cap.
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
$distillReceiptDir=Join-Path $Out 'stages'
New-Item -ItemType Directory -Path $distillReceiptDir | Out-Null
$distillInputKey='test-inputs'
$distillNode=(Get-Command node).Source
$distillExpected=@('with spaces','a"quoted"value','trailing slash\','plain')
Invoke-DistillStep 'arguments' $distillNode (@('-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--')+$distillExpected)
$distillActual=Get-Content -Raw (Join-Path $Out 'arguments.log') | ConvertFrom-Json
if (Compare-Object $distillExpected $distillActual -SyncWindow 0) { throw 'Windows argument roundtrip failed' }
if ($distillStages.Count -ne 1 -or $distillStages[0].exitCode -ne 0) { throw 'Successful exit was not recorded' }
Invoke-DistillStep 'arguments' $distillNode (@('-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--')+$distillExpected)
if ($distillStages.Count -ne 1 -or -not $distillStages[0].skipped) { throw 'Valid stage did not resume' }

$resultFile=Join-Path $Out 'result.json'
$counterFile=Join-Path $Out 'count.json'
$dependencyFile=Join-Path $Out 'dependency.json'
Set-Content $dependencyFile 'input-v1'
$childCode='const fs=require("fs"); const [result,count]=process.argv.slice(1); const n=fs.existsSync(count)?JSON.parse(fs.readFileSync(count)):0; fs.writeFileSync(count,JSON.stringify(n+1)); fs.writeFileSync(result,JSON.stringify({complete:true})); console.log("done")'
$childArgs=@('-e',$childCode,'--',$resultFile,$counterFile)
$validateResult={ (Get-Content -Raw $resultFile | ConvertFrom-Json).complete -eq $true }
Invoke-DistillStep 'artifact' $distillNode $childArgs @($resultFile) $validateResult @($dependencyFile)
Invoke-DistillStep 'artifact' $distillNode $childArgs @($resultFile) $validateResult @($dependencyFile)
if ((Get-Content -Raw $counterFile | ConvertFrom-Json) -ne 1) { throw 'Finished stage was repeated' }
Set-Content $resultFile '{"complete":false}'
Invoke-DistillStep 'artifact' $distillNode $childArgs @($resultFile) $validateResult @($dependencyFile)
if ((Get-Content -Raw $counterFile | ConvertFrom-Json) -ne 2) { throw 'Corrupt result was skipped' }
Set-Content $dependencyFile 'input-v2'
Invoke-DistillStep 'artifact' $distillNode $childArgs @($resultFile) $validateResult @($dependencyFile)
if ((Get-Content -Raw $counterFile | ConvertFrom-Json) -ne 3) { throw 'Changed dependency was skipped' }
$distillInputKey='changed-source'
Invoke-DistillStep 'artifact' $distillNode $childArgs @($resultFile) $validateResult @($dependencyFile)
if ((Get-Content -Raw $counterFile | ConvertFrom-Json) -ne 4) { throw 'Changed source was skipped' }
Set-Content (Join-Path $Out 'complete.json') '{"complete":true}'
$distillFailed=$false
try { Invoke-DistillStep 'failure' $distillNode @('-e','process.exit(7)') } catch { $distillFailed=$true }
if (-not $distillFailed -or $distillStages[2].exitCode -ne 7) { throw 'Failure was not propagated' }
if (Test-Path (Join-Path $Out 'complete.json')) { throw 'Failure preserved stale completion' }
$distillFailed=$false
try { Invoke-DistillStep 'invalid-result' $distillNode @('-e','console.log("invalid")') @() { $false } } catch { $distillFailed=$true }
if (-not $distillFailed -or (Test-Path (Join-Path $distillReceiptDir 'invalid-result.json'))) { throw 'Invalid result received a completion receipt' }
$distillClock=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalSeconds=4501;TotalMinutes=75.01}}
Invoke-DistillStep 'after-old-cap' $distillNode @('-e','console.log("no deadline")')
if ($distillStages[4].exitCode -ne 0) { throw 'Old runtime cap still enforced' }
Write-Host 'Runner parse, argument quoting, validated resume, corruption/dependency/source recovery, failure propagation and no-cap checks passed.'

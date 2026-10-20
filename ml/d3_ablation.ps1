param(
  [string]$Python = 'python',
  [Parameter(Mandatory)] [string[]]$Data,
  [Parameter(Mandatory)] [string]$Exam,
  [string]$Out = 'art/out/d3-night',
  [int]$Limit = 75000,
  [int]$Epochs = 100,
  [int]$Width = 512,
  [int]$Batch = 512,
  [int]$Seed = 203,
  [switch]$Smoke
)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $arguments = @('ml/d3_ablation.py', '--out', $Out, '--exam', $Exam,
    '--limit', $Limit, '--epochs', $Epochs, '--width', $Width, '--batch', $Batch, '--seed', $Seed)
  if ($Smoke) { $arguments += '--smoke' }
  $arguments += '--data'
  $arguments += $Data
  & $Python @arguments
  if ($LASTEXITCODE -ne 0) { throw "D3 failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }

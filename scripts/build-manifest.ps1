# Builds public/data/index.json without needing Node. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1
$dataDir = Join-Path $PSScriptRoot '..\public\data'
$files = @(Get-ChildItem -Path $dataDir -Filter *.json |
  Where-Object { $_.Name -ne 'index.json' } |
  Sort-Object Name |
  ForEach-Object { $_.Name })
$json = [ordered]@{ files = $files } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $dataDir 'index.json'), $json + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote data/index.json with $($files.Count) file(s)."

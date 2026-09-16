$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot (([char[]]@(47196,52972,51204,50857) -join '') + '\' + ([char[]]@(51068,51068,51216,44160) -join ''))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$date = Get-Date -Format 'yyyy-MM-dd'
$logPath = Join-Path $logDir "$date.log"

Push-Location $projectRoot
try {
  & npm.cmd run audit:daily -- $date *>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -ne 0) { throw "daily-integrity check failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

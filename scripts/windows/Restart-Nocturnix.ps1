[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'launcher.settings.local.psd1'),
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$powerShell = (Get-Process -Id $PID).Path
& $powerShell -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'Stop-Nocturnix.ps1') -ConfigPath $ConfigPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$startArguments = @(
    '-NoLogo',
    '-NoProfile',
    '-File', (Join-Path $PSScriptRoot 'Start-Nocturnix.ps1'),
    '-ConfigPath', $ConfigPath
)
if ($NoBrowser) { $startArguments += '-NoBrowser' }
& $powerShell @startArguments
exit $LASTEXITCODE

[CmdletBinding()]
param([string]$ConfigPath = (Join-Path $PSScriptRoot 'launcher.settings.local.psd1'))

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Nocturnix.Services.psm1') -Force
$configuration = Import-NocturnixConfiguration -Path $ConfigPath -AllowUninitialized
$context = [pscustomobject]@{
    StatePath = Join-Path (Join-Path $configuration.RuntimeRoot 'state') 'runtime.json'
    StopRequestPath = Join-Path (Join-Path $configuration.RuntimeRoot 'state') 'stop.request.json'
}
$state = Read-NocturnixRuntimeState -Path $context.StatePath
if (-not $state) {
    Write-Host 'No active Nocturnix supervisor state was found. Nothing was stopped.' -ForegroundColor Yellow
    exit 0
}
if (-not (Test-NocturnixProcessIdentity -Record $state.Supervisor)) {
    Write-Error 'The supervisor state is stale or its process identity does not match. No processes were stopped.'
    exit 1
}
Request-NocturnixShutdown -Context $context -State $state
Write-Host "Shutdown requested for Nocturnix instance $($state.InstanceId)." -ForegroundColor Cyan
$deadline = [DateTime]::UtcNow.AddSeconds($configuration.ShutdownTimeoutSeconds + 5)
while ([DateTime]::UtcNow -lt $deadline -and (Get-Process -Id $state.Supervisor.ProcessId -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 200
}
if (Get-Process -Id $state.Supervisor.ProcessId -ErrorAction SilentlyContinue) {
    Write-Error 'The supervisor did not exit within the shutdown timeout. It was not forcefully terminated.'
    exit 1
}
Write-Host 'Nocturnix launcher-owned services stopped. Adopted services were preserved.' -ForegroundColor Green

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'launcher.settings.local.psd1'),
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Nocturnix startup requires PowerShell 7 or newer.'
}

$modulePath = Join-Path $PSScriptRoot 'Nocturnix.Services.psm1'
Import-Module $modulePath -Force
$configuration = Import-NocturnixConfiguration -Path $ConfigPath
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value.Replace('-', '_')
$mutex = [System.Threading.Mutex]::new($false, "Local\Nocturnix.Manuals.$userSid")
$hasMutex = $false
$job = $null
$context = $null
$serviceRecords = @()
$exitCode = 0

try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) { throw 'Nocturnix Manuals is already supervised for this Windows user.' }
    $instanceId = [guid]::NewGuid().ToString('N')
    $shutdownToken = New-NocturnixShutdownToken
    $context = Initialize-NocturnixRuntimeContext -Configuration $configuration -InstanceId $instanceId
    Remove-Item -LiteralPath $context.StopRequestPath -Force -ErrorAction SilentlyContinue
    Write-NocturnixLog -Context $context -Message "Starting Nocturnix Manuals instance $instanceId."

    $supervisor = Get-Process -Id $PID
    $supervisorRecord = New-NocturnixProcessRecord -Process $supervisor -ServiceName 'Supervisor' -ExecutablePath $supervisor.Path -InstanceId $instanceId
    if ($configuration.EnableCrashCleanup) {
        $job = New-NocturnixJobObject -Name "Nocturnix.Manuals.$userSid.$instanceId"
        Write-NocturnixLog -Context $context -Message 'Windows Job Object crash cleanup is enabled for launcher-owned children.'
    }

    foreach ($service in $configuration.Services) {
        $disposition = Get-NocturnixServiceDisposition -Service $service -Configuration $configuration
        Write-NocturnixLog -Context $context -Message $disposition.Message
        if ($disposition.Action -eq 'Conflict') { throw $disposition.Message }
        if ($disposition.Action -eq 'Adopt') {
            $serviceRecords += [pscustomobject]@{ Service=$service.Name; Owned=$false; ProcessId=$null; StartTimeUtcTicks=$null; ExecutablePath=$null; InstanceId=$instanceId }
        }
        else {
            $started = Start-NocturnixOwnedProcess -Service $service -Configuration $configuration -Context $context -InstanceId $instanceId -Job $job
            $serviceRecords += $started.Record
            Write-NocturnixRuntimeState -Context $context -Configuration $configuration -SupervisorRecord $supervisorRecord -ShutdownToken $shutdownToken -Services $serviceRecords
            Wait-NocturnixServiceReady -Service $service -Configuration $configuration -Process $started.Process -TimeoutSeconds $configuration.StartupTimeoutSeconds | Out-Null
            Write-NocturnixLog -Context $context -Message "$($service.Name) passed its HTTP identity check."
        }
    }

    Write-NocturnixRuntimeState -Context $context -Configuration $configuration -SupervisorRecord $supervisorRecord -ShutdownToken $shutdownToken -Services $serviceRecords
    Write-NocturnixLog -Context $context -Message "Nocturnix Manuals is ready at $($configuration.FrontendOrigin)/"
    if ($configuration.OpenBrowser -and -not $NoBrowser) {
        Start-Process ($configuration.FrontendOrigin + '/')
    }
    Write-Host 'Use Stop-Nocturnix.ps1 or press Ctrl+C to stop launcher-owned services.' -ForegroundColor Green

    while ($true) {
        if (Test-NocturnixShutdownRequested -Context $context -InstanceId $instanceId -ShutdownToken $shutdownToken) {
            Write-NocturnixLog -Context $context -Message 'A valid per-user shutdown request was received.'
            break
        }
        foreach ($record in @($serviceRecords | Where-Object Owned)) {
            if (-not (Test-NocturnixProcessIdentity -Record $record)) {
                throw "Owned $($record.Service) process exited or changed identity."
            }
        }
        Start-Sleep -Milliseconds 500
    }
}
catch {
    $exitCode = 1
    if ($context) { Write-NocturnixLog -Context $context -Level ERROR -Message $_.Exception.Message }
    else { Write-Error $_ }
}
finally {
    if ($context) {
        Stop-NocturnixOwnedProcesses -ServiceRecords $serviceRecords -Context $context -TimeoutSeconds $configuration.ShutdownTimeoutSeconds -Job $job
        Remove-Item -LiteralPath $context.StatePath, $context.StopRequestPath -Force -ErrorAction SilentlyContinue
        Write-NocturnixLog -Context $context -Message 'Nocturnix Manuals supervisor stopped.'
    }
    elseif ($job) { $job.Dispose() }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
exit $exitCode

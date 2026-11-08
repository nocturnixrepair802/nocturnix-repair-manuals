$windowsRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $windowsRoot '..\..'))
$modulePath = Join-Path $windowsRoot 'Nocturnix.Services.psm1'
$startScript = Join-Path $windowsRoot 'Start-Nocturnix.ps1'
$stopScript = Join-Path $windowsRoot 'Stop-Nocturnix.ps1'
$restartScript = Join-Path $windowsRoot 'Restart-Nocturnix.ps1'
Import-Module $modulePath -Force

$runtimeInputs = [ordered]@{
    PythonExecutable = $env:NOCTURNIX_TEST_PYTHON_EXE
    FrontendDistPath = $env:NOCTURNIX_TEST_FRONTEND_DIST
    KiwixExecutable = $env:NOCTURNIX_TEST_KIWIX_EXE
    CatalogPath = $env:NOCTURNIX_TEST_CATALOG_PATH
    ZimPath = $env:NOCTURNIX_TEST_ZIM_PATH
}
$skipRuntime = $false
foreach ($entry in $runtimeInputs.GetEnumerator()) {
    if (-not $entry.Value -or -not (Test-Path -LiteralPath $entry.Value)) { $skipRuntime = $true }
}

function Get-FreeNocturnixPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function New-IntegrationConfiguration {
    param([string]$Name)
    $runtimeRoot = Join-Path $TestDrive "$Name-runtime"
    $configPath = Join-Path $TestDrive "$Name.settings.local.psd1"
    $ports = @()
    while ($ports.Count -lt 3) {
        $candidate = Get-FreeNocturnixPort
        if ($candidate -notin $ports) { $ports += $candidate }
    }
    Write-NocturnixLocalConfiguration `
        -Path $configPath `
        -RepositoryRoot $repositoryRoot `
        -PythonExecutable $runtimeInputs.PythonExecutable `
        -FrontendDistPath $runtimeInputs.FrontendDistPath `
        -KiwixExecutable $runtimeInputs.KiwixExecutable `
        -CatalogPath $runtimeInputs.CatalogPath `
        -ZimPath $runtimeInputs.ZimPath `
        -ArchiveId 'ifixit_en_all_2025-12' `
        -RuntimeRoot $runtimeRoot `
        -FrontendPort $ports[0] `
        -BackendPort $ports[1] `
        -KiwixPort $ports[2] `
        -StartupTimeoutSeconds 30 `
        -ShutdownTimeoutSeconds 8 `
        -OpenBrowser:$false | Out-Null
    return [pscustomobject]@{
        Path = $configPath
        RuntimeRoot = $runtimeRoot
        Configuration = Import-NocturnixConfiguration -Path $configPath
    }
}

function ConvertTo-EncodedNocturnixCommand {
    param([string]$ScriptPath, [string]$ConfigPath, [switch]$NoBrowser)
    $escapedScript = $ScriptPath.Replace("'", "''")
    $escapedConfig = $ConfigPath.Replace("'", "''")
    $command = "& '$escapedScript' -ConfigPath '$escapedConfig'"
    if ($NoBrowser) { $command += ' -NoBrowser' }
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
}

function Start-NocturnixTestScript {
    param([string]$ScriptPath, [string]$ConfigPath, [string]$Name, [switch]$NoBrowser)
    $encoded = ConvertTo-EncodedNocturnixCommand -ScriptPath $ScriptPath -ConfigPath $ConfigPath -NoBrowser:$NoBrowser
    $parameters = @{
        FilePath = (Get-Process -Id $PID).Path
        ArgumentList = @('-NoLogo', '-NoProfile', '-EncodedCommand', $encoded)
        WindowStyle = 'Hidden'
        RedirectStandardOutput = (Join-Path $TestDrive "$Name.out.log")
        RedirectStandardError = (Join-Path $TestDrive "$Name.err.log")
        PassThru = $true
    }
    return Start-Process @parameters
}

function Wait-NocturnixStackReady {
    param([psobject]$Configuration, [System.Diagnostics.Process]$Supervisor, [int]$TimeoutSeconds = 45)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Supervisor.Refresh()
        if ($Supervisor.HasExited) { throw "Supervisor exited with code $($Supervisor.ExitCode) before readiness." }
        $healthy = $true
        foreach ($service in $Configuration.Services) {
            if (-not (Invoke-NocturnixServiceProbe -Service $service -Configuration $Configuration -TimeoutSeconds 2).Healthy) {
                $healthy = $false
                break
            }
        }
        if ($healthy) { return }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The integration stack did not become ready before the timeout.'
}

function Wait-NocturnixPortClosed {
    param([int]$Port, [int]$TimeoutSeconds = 15)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (-not (Test-NocturnixTcpPort -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Invoke-NocturnixTestStop {
    param([string]$ConfigPath, [string]$Name)
    $process = Start-NocturnixTestScript -ScriptPath $stopScript -ConfigPath $ConfigPath -Name $Name
    $process.WaitForExit(20000) | Out-Null
    $process.Refresh()
    return $process.ExitCode
}

Describe 'Nocturnix supervisor full-stack lifecycle integration' {
    It 'starts dependencies, passes HTTP identity checks, and shuts down only its owned stack' -Skip:$skipRuntime {
        $fixture = New-IntegrationConfiguration -Name 'startup-shutdown'
        $supervisor = Start-NocturnixTestScript -ScriptPath $startScript -ConfigPath $fixture.Path -Name 'startup-shutdown' -NoBrowser
        try {
            Wait-NocturnixStackReady -Configuration $fixture.Configuration -Supervisor $supervisor
            $statePath = Join-Path $fixture.RuntimeRoot 'state\runtime.json'
            $state = Read-NocturnixRuntimeState -Path $statePath
            $state.Services.Count | Should Be 3
            @($state.Services | Where-Object Owned).Count | Should Be 3
            (Invoke-NocturnixTestStop -ConfigPath $fixture.Path -Name 'startup-shutdown-stop') | Should Be 0
            $supervisor.WaitForExit(15000) | Should Be $true
            foreach ($service in $fixture.Configuration.Services) {
                (Wait-NocturnixPortClosed -Port $service.Port) | Should Be $true
            }
        }
        finally {
            Stop-Process -Id $supervisor.Id -Force -ErrorAction SilentlyContinue
        }
    }

    It 'adopts healthy external services and preserves every adopted process on shutdown' -Skip:$skipRuntime {
        $fixture = New-IntegrationConfiguration -Name 'adoption'
        $instance = [guid]::NewGuid().ToString('N')
        $context = Initialize-NocturnixRuntimeContext -Configuration $fixture.Configuration -InstanceId $instance
        $externalRecords = @()
        $supervisor = $null
        try {
            foreach ($service in $fixture.Configuration.Services) {
                $started = Start-NocturnixOwnedProcess -Service $service -Configuration $fixture.Configuration -Context $context -InstanceId $instance
                $externalRecords += $started.Record
                Wait-NocturnixServiceReady -Service $service -Configuration $fixture.Configuration -Process $started.Process -TimeoutSeconds 30 | Out-Null
            }
            $supervisor = Start-NocturnixTestScript -ScriptPath $startScript -ConfigPath $fixture.Path -Name 'adoption-supervisor' -NoBrowser
            Wait-NocturnixStackReady -Configuration $fixture.Configuration -Supervisor $supervisor
            $statePath = Join-Path $fixture.RuntimeRoot 'state\runtime.json'
            $deadline = [DateTime]::UtcNow.AddSeconds(15)
            $state = $null
            do {
                Start-Sleep -Milliseconds 100
                $state = Read-NocturnixRuntimeState -Path $statePath
            } while ([DateTime]::UtcNow -lt $deadline -and (-not $state -or [int]$state.Supervisor.ProcessId -ne $supervisor.Id -or $state.Services.Count -ne 3))
            [int]$state.Supervisor.ProcessId | Should Be $supervisor.Id
            $state.Services.Count | Should Be 3
            @($state.Services | Where-Object Owned).Count | Should Be 0
            (Invoke-NocturnixTestStop -ConfigPath $fixture.Path -Name 'adoption-stop') | Should Be 0
            $supervisor.WaitForExit(15000) | Should Be $true
            foreach ($record in $externalRecords) {
                (Test-NocturnixProcessIdentity -Record $record) | Should Be $true
            }
        }
        finally {
            if ($supervisor) { Stop-Process -Id $supervisor.Id -Force -ErrorAction SilentlyContinue }
            Stop-NocturnixOwnedProcesses -ServiceRecords $externalRecords -Context $context -TimeoutSeconds 5
        }
    }

    It 'cleans up started dependencies but leaves an unexpected port owner untouched after failure' -Skip:$skipRuntime {
        $fixture = New-IntegrationConfiguration -Name 'failure-recovery'
        $frontendPort = $fixture.Configuration.FrontendPort
        $dummy = Start-Process -FilePath $runtimeInputs.PythonExecutable -ArgumentList @('-m','http.server',"$frontendPort",'--bind','127.0.0.1') -WindowStyle Hidden -PassThru
        $supervisor = $null
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            while (-not (Test-NocturnixTcpPort -Port $frontendPort) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            (Test-NocturnixTcpPort -Port $frontendPort) | Should Be $true
            $supervisor = Start-NocturnixTestScript -ScriptPath $startScript -ConfigPath $fixture.Path -Name 'failure-recovery' -NoBrowser
            $supervisor.WaitForExit(45000) | Should Be $true
            $supervisor.ExitCode | Should Be 1
            (Get-Process -Id $dummy.Id -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
            (Wait-NocturnixPortClosed -Port $fixture.Configuration.KiwixPort) | Should Be $true
            (Wait-NocturnixPortClosed -Port $fixture.Configuration.BackendPort) | Should Be $true
        }
        finally {
            if ($supervisor) { Stop-Process -Id $supervisor.Id -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $dummy.Id -Force -ErrorAction SilentlyContinue
        }
    }

    It 'restarts through authenticated shutdown and produces a new supervisor instance' -Skip:$skipRuntime {
        $fixture = New-IntegrationConfiguration -Name 'restart'
        $first = Start-NocturnixTestScript -ScriptPath $startScript -ConfigPath $fixture.Path -Name 'restart-first' -NoBrowser
        $restart = $null
        try {
            Wait-NocturnixStackReady -Configuration $fixture.Configuration -Supervisor $first
            $statePath = Join-Path $fixture.RuntimeRoot 'state\runtime.json'
            $firstState = Read-NocturnixRuntimeState -Path $statePath
            $restart = Start-NocturnixTestScript -ScriptPath $restartScript -ConfigPath $fixture.Path -Name 'restart-command' -NoBrowser
            $deadline = [DateTime]::UtcNow.AddSeconds(45)
            $secondState = $null
            do {
                Start-Sleep -Milliseconds 250
                $secondState = Read-NocturnixRuntimeState -Path $statePath
            } while ([DateTime]::UtcNow -lt $deadline -and (-not $secondState -or $secondState.InstanceId -eq $firstState.InstanceId))
            ($secondState.InstanceId -ne $firstState.InstanceId) | Should Be $true
            $secondProcess = Get-Process -Id $secondState.Supervisor.ProcessId -ErrorAction Stop
            Wait-NocturnixStackReady -Configuration $fixture.Configuration -Supervisor $secondProcess
            (Invoke-NocturnixTestStop -ConfigPath $fixture.Path -Name 'restart-stop') | Should Be 0
            $restart.WaitForExit(20000) | Should Be $true
            foreach ($service in $fixture.Configuration.Services) {
                (Wait-NocturnixPortClosed -Port $service.Port) | Should Be $true
            }
        }
        finally {
            if ($restart -and -not $restart.HasExited) {
                try { Invoke-NocturnixTestStop -ConfigPath $fixture.Path -Name 'restart-finally-stop' | Out-Null } catch {}
            }
            Stop-Process -Id $first.Id -Force -ErrorAction SilentlyContinue
            if ($restart) { Stop-Process -Id $restart.Id -Force -ErrorAction SilentlyContinue }
        }
    }
}

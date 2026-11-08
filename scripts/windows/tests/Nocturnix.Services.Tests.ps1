$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Nocturnix.Services.psm1'
Import-Module $modulePath -Force

function New-TestConfigurationFile {
    param([string]$BindAddress = '127.0.0.1', [int]$FrontendPort = 15173, [int]$BackendPort = 18765, [int]$KiwixPort = 18080)
    $root = Join-Path $TestDrive 'Repository With Spaces'
    $service = Join-Path $root 'services\manuals-api'
    $web = Join-Path $root 'apps\web\dist'
    $python = Join-Path $service '.venv\Scripts\python.exe'
    $kiwix = Join-Path $TestDrive 'Kiwix Tools\kiwix-serve.exe'
    $catalog = Join-Path $TestDrive 'Catalog Data\repair_guides.db'
    $zim = Join-Path $TestDrive 'Archive Data\ifixit.zim'
    foreach ($directory in @($service, $web, (Split-Path $python), (Split-Path $kiwix), (Split-Path $catalog), (Split-Path $zim))) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    foreach ($file in @($python, $kiwix, $catalog, $zim, (Join-Path $web 'index.html'))) {
        Set-Content -LiteralPath $file -Value 'fixture'
    }
    $configPath = Join-Path $TestDrive ("launcher-{0}.settings.local.psd1" -f [guid]::NewGuid().ToString('N'))
    $content = @"
@{
SchemaVersion=1
RepositoryRoot='$($root.Replace("'", "''"))'
PythonExecutable='$($python.Replace("'", "''"))'
FrontendDistPath='$($web.Replace("'", "''"))'
KiwixExecutable='$($kiwix.Replace("'", "''"))'
CatalogPath='$($catalog.Replace("'", "''"))'
ZimPath='$($zim.Replace("'", "''"))'
ArchiveId='ifixit_en_all_2025-12'
BindAddress='$BindAddress'
FrontendPort=$FrontendPort
BackendPort=$BackendPort
KiwixPort=$KiwixPort
StartupTimeoutSeconds=20
ShutdownTimeoutSeconds=8
LogRetentionDays=14
OpenBrowser=`$false
EnableCrashCleanup=`$true
RuntimeRoot='$((Join-Path $TestDrive 'Runtime').Replace("'", "''"))'
}
"@
    Set-Content -LiteralPath $configPath -Value $content
    return $configPath
}

Describe 'Nocturnix launcher configuration' {
    It 'accepts initialized absolute paths containing spaces' {
        $config = Import-NocturnixConfiguration -Path (New-TestConfigurationFile)
        $config.BindAddress | Should Be '127.0.0.1'
        $config.Services.Count | Should Be 3
        $config.FrontendOrigin | Should Be 'http://127.0.0.1:15173'
    }

    It 'rejects public bind addresses' {
        $threw = $false
        try { Import-NocturnixConfiguration -Path (New-TestConfigurationFile -BindAddress '0.0.0.0') | Out-Null }
        catch { $threw = $true }
        $threw | Should Be $true
    }

    It 'rejects duplicate ports' {
        $threw = $false
        try { Import-NocturnixConfiguration -Path (New-TestConfigurationFile -BackendPort 15173) | Out-Null }
        catch { $threw = $true }
        $threw | Should Be $true
    }

    It 'rejects missing initialized files' {
        $path = New-TestConfigurationFile
        Remove-Item -LiteralPath (Join-Path $TestDrive 'Archive Data\ifixit.zim')
        $threw = $false
        try { Import-NocturnixConfiguration -Path $path | Out-Null }
        catch { $threw = $true }
        $threw | Should Be $true
    }

    It 'writes a validated ignored local configuration without losing path characters' {
        $source = Import-NocturnixConfiguration -Path (New-TestConfigurationFile)
        $outputDirectory = Join-Path $TestDrive "Generated User's Settings"
        $outputPath = Join-Path $outputDirectory 'launcher.settings.local.psd1'
        $result = Write-NocturnixLocalConfiguration `
            -Path $outputPath `
            -RepositoryRoot $source.RepositoryRoot `
            -PythonExecutable $source.PythonExecutable `
            -FrontendDistPath $source.FrontendDistPath `
            -KiwixExecutable $source.KiwixExecutable `
            -CatalogPath $source.CatalogPath `
            -ZimPath $source.ZimPath `
            -ArchiveId $source.ArchiveId `
            -RuntimeRoot (Join-Path $TestDrive "User's Runtime") `
            -FrontendPort $source.FrontendPort `
            -BackendPort $source.BackendPort `
            -KiwixPort $source.KiwixPort `
            -OpenBrowser:$false
        $result | Should Be $outputPath
        $generated = Import-NocturnixConfiguration -Path $outputPath
        $generated.BindAddress | Should Be '127.0.0.1'
        $generated.RuntimeRoot | Should Be (Join-Path $TestDrive "User's Runtime")
        $generated.OpenBrowser | Should Be $false
        $generated.EnableCrashCleanup | Should Be $true
    }

    It 'does not overwrite an existing local configuration without explicit force' {
        $sourcePath = New-TestConfigurationFile
        $source = Import-NocturnixConfiguration -Path $sourcePath
        $threw = $false
        try {
            Write-NocturnixLocalConfiguration `
                -Path $sourcePath `
                -RepositoryRoot $source.RepositoryRoot `
                -PythonExecutable $source.PythonExecutable `
                -FrontendDistPath $source.FrontendDistPath `
                -KiwixExecutable $source.KiwixExecutable `
                -CatalogPath $source.CatalogPath `
                -ZimPath $source.ZimPath `
                -ArchiveId $source.ArchiveId `
                -RuntimeRoot $source.RuntimeRoot | Out-Null
        }
        catch { $threw = $true }
        $threw | Should Be $true
    }
}

Describe 'Nocturnix one-click workflow separation' {
    It 'keeps package installation and Vite out of daily startup' {
        $windowsRoot = Split-Path -Parent $PSScriptRoot
        $dailyStartup = Get-Content -LiteralPath (Join-Path $windowsRoot 'Start-Nocturnix.ps1') -Raw
        $dailyStartup | Should Not Match '(?i)npm|node|vite|uv sync'
        $initializer = Get-Content -LiteralPath (Join-Path $windowsRoot 'Initialize-Nocturnix.ps1') -Raw
        $initializer | Should Match 'sync --frozen'
        $initializer | Should Match 'npm\.cmd'
        $initializer | Should Match 'build:local'
    }

    It 'routes the CMD launcher only to the PowerShell supervisor' {
        $windowsRoot = Split-Path -Parent $PSScriptRoot
        $launcher = Get-Content -LiteralPath (Join-Path $windowsRoot 'Start Nocturnix Manuals.cmd') -Raw
        $launcher | Should Match 'Start-Nocturnix\.ps1'
        $launcher | Should Not Match '(?i)npm|node|vite|kiwix-serve'
    }

    It 'keeps all committed PowerShell files syntactically valid' {
        $windowsRoot = Split-Path -Parent $PSScriptRoot
        $parseFailures = @()
        Get-ChildItem -LiteralPath $windowsRoot -Include '*.ps1','*.psm1' -File -Recurse | ForEach-Object {
            $parseErrors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$parseErrors) | Out-Null
            if ($parseErrors) { $parseFailures += $parseErrors.Message }
        }
        $parseFailures.Count | Should Be 0
    }
}

Describe 'Nocturnix service identity and adoption' {
    BeforeEach { $script:config = Import-NocturnixConfiguration -Path (New-TestConfigurationFile) }

    It 'adopts an exact frontend identity' {
        $service = $script:config.Services | Where-Object Name -eq 'Frontend'
        $request = { param($uri, $timeout) [pscustomobject]@{ StatusCode=200; Content='{"service":"nocturnix-manuals-web","origin":"http://127.0.0.1:15173"}' } }
        $result = Get-NocturnixServiceDisposition -Service $service -Configuration $script:config -RequestInvoker $request -PortTester { $false }
        $result.Action | Should Be 'Adopt'
    }

    It 'rejects an occupied port with the wrong identity' {
        $service = $script:config.Services | Where-Object Name -eq 'Frontend'
        $request = { throw 'wrong server' }
        $result = Get-NocturnixServiceDisposition -Service $service -Configuration $script:config -RequestInvoker $request -PortTester { $true }
        $result.Action | Should Be 'Conflict'
    }

    It 'starts only when the expected service and port are absent' {
        $service = $script:config.Services | Where-Object Name -eq 'Backend'
        $result = Get-NocturnixServiceDisposition -Service $service -Configuration $script:config -RequestInvoker { throw 'not running' } -PortTester { $false }
        $result.Action | Should Be 'Start'
    }

    It 'requires both the Kiwix viewer and configured archive' {
        $service = $script:config.Services | Where-Object Name -eq 'Kiwix'
        $request = {
            param($uri, $timeout)
            if ($uri -match '/viewer$') { return [pscustomobject]@{ StatusCode=200; Content='<title>ZIM Viewer</title>' } }
            return [pscustomobject]@{ StatusCode=404; Content='missing' }
        }
        (Invoke-NocturnixServiceProbe -Service $service -Configuration $script:config -RequestInvoker $request).Healthy | Should Be $false
    }
}

Describe 'Nocturnix process identity' {
    It 'matches PID, creation time, and executable path together' {
        $process = Get-Process -Id $PID
        $record = New-NocturnixProcessRecord -Process $process -ServiceName 'Test' -ExecutablePath $process.Path -InstanceId 'test-instance'
        (Test-NocturnixProcessIdentity -Record $record) | Should Be $true
        $record.StartTimeUtcTicks = [int64]$record.StartTimeUtcTicks + 1
        (Test-NocturnixProcessIdentity -Record $record) | Should Be $false
    }

    It 'never treats adopted services as owned processes' {
        $process = Get-Process -Id $PID
        $record = New-NocturnixProcessRecord -Process $process -ServiceName 'Adopted' -ExecutablePath $process.Path -InstanceId 'test-instance' -Owned:$false
        (Test-NocturnixProcessIdentity -Record $record) | Should Be $false
    }
}

Describe 'Nocturnix authenticated shutdown state' {
    BeforeEach {
        $script:config = Import-NocturnixConfiguration -Path (New-TestConfigurationFile)
        $script:instance = [guid]::NewGuid().ToString('N')
        $script:context = Initialize-NocturnixRuntimeContext -Configuration $script:config -InstanceId $script:instance
        $process = Get-Process -Id $PID
        $script:supervisor = New-NocturnixProcessRecord -Process $process -ServiceName 'Supervisor' -ExecutablePath $process.Path -InstanceId $script:instance
    }

    It 'accepts only a matching instance and random shutdown token' {
        $token = New-NocturnixShutdownToken
        $token.Length | Should Be 64
        Write-NocturnixRuntimeState -Context $script:context -Configuration $script:config -SupervisorRecord $script:supervisor -ShutdownToken $token -Services @()
        $state = Read-NocturnixRuntimeState -Path $script:context.StatePath
        Request-NocturnixShutdown -Context $script:context -State $state
        (Test-NocturnixShutdownRequested -Context $script:context -InstanceId $script:instance -ShutdownToken $token) | Should Be $true
    }

    It 'rejects and removes a forged shutdown request' {
        Set-Content -LiteralPath $script:context.StopRequestPath -Value '{"InstanceId":"wrong","ShutdownToken":"wrong"}'
        (Test-NocturnixShutdownRequested -Context $script:context -InstanceId $script:instance -ShutdownToken (New-NocturnixShutdownToken)) | Should Be $false
        (Test-Path -LiteralPath $script:context.StopRequestPath) | Should Be $false
    }

    It 'preserves adopted service records during shutdown' {
        $adopted = [pscustomobject]@{ Service='External'; Owned=$false; ProcessId=$PID; StartTimeUtcTicks=0; ExecutablePath=''; InstanceId=$script:instance }
        Stop-NocturnixOwnedProcesses -ServiceRecords @($adopted) -Context $script:context -TimeoutSeconds 1
        (Get-Process -Id $PID -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
    }

    It 'refuses stale supervisor state without terminating the referenced process' {
        $token = New-NocturnixShutdownToken
        $script:supervisor.StartTimeUtcTicks = [int64]$script:supervisor.StartTimeUtcTicks + 1
        $stopScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'Stop-Nocturnix.ps1'
        $escapedScript = $stopScript.Replace("'", "''")
        $configPath = New-TestConfigurationFile
        $config = Import-NocturnixConfiguration -Path $configPath
        $context = Initialize-NocturnixRuntimeContext -Configuration $config -InstanceId $script:instance
        Write-NocturnixRuntimeState -Context $context -Configuration $config -SupervisorRecord $script:supervisor -ShutdownToken $token -Services @()
        $escapedConfig = $configPath.Replace("'", "''")
        $command = "& '$escapedScript' -ConfigPath '$escapedConfig'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $stopProcess = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList '-NoProfile','-EncodedCommand',$encoded -WindowStyle Hidden -PassThru -Wait
        $stopProcess.ExitCode | Should Be 1
        (Get-Process -Id $PID -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
    }
}

Describe 'Nocturnix Windows Job Object cleanup' {
    It 'terminates only an explicitly assigned child when the job closes' {
        $command = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep -Seconds 30'))
        $child = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList '-NoProfile','-EncodedCommand',$command -WindowStyle Hidden -PassThru
        $job = $null
        try {
            $job = New-NocturnixJobObject -Name ('Nocturnix.Test.' + [guid]::NewGuid().ToString('N'))
            Add-NocturnixProcessToJob -Job $job -Process $child
            (Get-Process -Id $child.Id -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
            $job.Dispose()
            $job = $null
            $child.WaitForExit(5000) | Should Be $true
            (Get-Process -Id $child.Id -ErrorAction SilentlyContinue) | Should BeNullOrEmpty
            (Get-Process -Id $PID -ErrorAction SilentlyContinue) | Should Not BeNullOrEmpty
        }
        finally {
            if ($job) { $job.Dispose() }
            Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

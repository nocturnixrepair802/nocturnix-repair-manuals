Set-StrictMode -Version Latest

$script:ServiceId = 'Nocturnix.Manuals'
$script:FrontendIdentity = 'nocturnix-manuals-web'

function Test-NocturnixAbsolutePath {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.Path]::IsPathRooted($Path)
}

function Assert-NocturnixPort {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][object]$Value
    )
    $port = 0
    if (-not [int]::TryParse([string]$Value, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
        throw "$Name must be an integer from 1024 through 65535."
    }
    return $port
}

function Get-NocturnixRequiredConfigurationKeys {
    return @(
        'SchemaVersion', 'RepositoryRoot', 'PythonExecutable', 'FrontendDistPath',
        'KiwixExecutable', 'CatalogPath', 'ZimPath', 'ArchiveId', 'BindAddress',
        'FrontendPort', 'BackendPort', 'KiwixPort', 'StartupTimeoutSeconds',
        'ShutdownTimeoutSeconds', 'LogRetentionDays', 'OpenBrowser', 'EnableCrashCleanup', 'RuntimeRoot'
    )
}

function Import-NocturnixConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [switch]$AllowUninitialized
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Launcher configuration was not found: $Path"
    }
    $raw = Import-PowerShellDataFile -LiteralPath $Path
    foreach ($key in Get-NocturnixRequiredConfigurationKeys) {
        if (-not $raw.ContainsKey($key)) {
            throw "Launcher configuration is missing '$key'."
        }
    }
    if ([int]$raw.SchemaVersion -ne 1) {
        throw 'Launcher configuration schema is not supported.'
    }
    if ([string]$raw.BindAddress -ne '127.0.0.1') {
        throw 'All Nocturnix services must bind to 127.0.0.1.'
    }
    if ([string]$raw.ArchiveId -notmatch '^[A-Za-z0-9._-]{1,128}$') {
        throw 'ArchiveId contains unsupported characters.'
    }

    $pathKeys = @(
        'RepositoryRoot', 'PythonExecutable', 'FrontendDistPath', 'KiwixExecutable',
        'CatalogPath', 'ZimPath', 'RuntimeRoot'
    )
    $resolvedPaths = @{}
    foreach ($key in $pathKeys) {
        $value = [string]$raw[$key]
        if (-not (Test-NocturnixAbsolutePath -Path $value)) {
            throw "$key must be an absolute path."
        }
        $resolvedPaths[$key] = [System.IO.Path]::GetFullPath($value)
    }

    $frontendPort = Assert-NocturnixPort -Name 'FrontendPort' -Value $raw.FrontendPort
    $backendPort = Assert-NocturnixPort -Name 'BackendPort' -Value $raw.BackendPort
    $kiwixPort = Assert-NocturnixPort -Name 'KiwixPort' -Value $raw.KiwixPort
    if (@(@($frontendPort, $backendPort, $kiwixPort) | Sort-Object -Unique).Count -ne 3) {
        throw 'FrontendPort, BackendPort, and KiwixPort must be distinct.'
    }

    foreach ($duration in @('StartupTimeoutSeconds', 'ShutdownTimeoutSeconds')) {
        if ([int]$raw[$duration] -lt 1 -or [int]$raw[$duration] -gt 300) {
            throw "$duration must be from 1 through 300."
        }
    }
    if ([int]$raw.LogRetentionDays -lt 1 -or [int]$raw.LogRetentionDays -gt 365) {
        throw 'LogRetentionDays must be from 1 through 365.'
    }

    if (-not $AllowUninitialized) {
        $requiredFiles = @{
            PythonExecutable = $resolvedPaths.PythonExecutable
            KiwixExecutable = $resolvedPaths.KiwixExecutable
            CatalogPath = $resolvedPaths.CatalogPath
            ZimPath = $resolvedPaths.ZimPath
            FrontendIndex = Join-Path $resolvedPaths.FrontendDistPath 'index.html'
        }
        if (-not (Test-Path -LiteralPath $resolvedPaths.RepositoryRoot -PathType Container)) {
            throw "RepositoryRoot does not exist: $($resolvedPaths.RepositoryRoot)"
        }
        foreach ($entry in $requiredFiles.GetEnumerator()) {
            if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
                throw "$($entry.Key) does not exist: $($entry.Value)"
            }
        }
    }

    $frontendOrigin = "http://127.0.0.1:$frontendPort"
    $backendOrigin = "http://127.0.0.1:$backendPort"
    $kiwixOrigin = "http://127.0.0.1:$kiwixPort"
    $services = @(
        [pscustomobject]@{
            Name = 'Kiwix'
            ProbeKind = 'Kiwix'
            Port = $kiwixPort
            HealthUrl = "$kiwixOrigin/content/$($raw.ArchiveId)/"
            ViewerUrl = "$kiwixOrigin/viewer"
            ExecutablePath = $resolvedPaths.KiwixExecutable
            WorkingDirectory = Split-Path -Parent $resolvedPaths.KiwixExecutable
        },
        [pscustomobject]@{
            Name = 'Backend'
            ProbeKind = 'Backend'
            Port = $backendPort
            HealthUrl = "$backendOrigin/api/offline-guides/status"
            ExecutablePath = $resolvedPaths.PythonExecutable
            WorkingDirectory = Join-Path $resolvedPaths.RepositoryRoot 'services\manuals-api'
        },
        [pscustomobject]@{
            Name = 'Frontend'
            ProbeKind = 'Frontend'
            Port = $frontendPort
            HealthUrl = "$frontendOrigin/healthz"
            ExecutablePath = $resolvedPaths.PythonExecutable
            WorkingDirectory = Join-Path $resolvedPaths.RepositoryRoot 'services\manuals-api'
        }
    )

    return [pscustomobject]@{
        SchemaVersion = 1
        RepositoryRoot = $resolvedPaths.RepositoryRoot
        PythonExecutable = $resolvedPaths.PythonExecutable
        FrontendDistPath = $resolvedPaths.FrontendDistPath
        KiwixExecutable = $resolvedPaths.KiwixExecutable
        CatalogPath = $resolvedPaths.CatalogPath
        ZimPath = $resolvedPaths.ZimPath
        ArchiveId = [string]$raw.ArchiveId
        BindAddress = '127.0.0.1'
        FrontendPort = $frontendPort
        BackendPort = $backendPort
        KiwixPort = $kiwixPort
        FrontendOrigin = $frontendOrigin
        BackendOrigin = $backendOrigin
        KiwixOrigin = $kiwixOrigin
        StartupTimeoutSeconds = [int]$raw.StartupTimeoutSeconds
        ShutdownTimeoutSeconds = [int]$raw.ShutdownTimeoutSeconds
        LogRetentionDays = [int]$raw.LogRetentionDays
        OpenBrowser = [bool]$raw.OpenBrowser
        EnableCrashCleanup = [bool]$raw.EnableCrashCleanup
        RuntimeRoot = $resolvedPaths.RuntimeRoot
        Services = $services
    }
}

function ConvertTo-NocturnixDataFileString {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Write-NocturnixLocalConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$PythonExecutable,
        [Parameter(Mandatory)][string]$FrontendDistPath,
        [Parameter(Mandatory)][string]$KiwixExecutable,
        [Parameter(Mandatory)][string]$CatalogPath,
        [Parameter(Mandatory)][string]$ZimPath,
        [Parameter(Mandatory)][string]$ArchiveId,
        [Parameter(Mandatory)][string]$RuntimeRoot,
        [int]$FrontendPort = 5173,
        [int]$BackendPort = 8765,
        [int]$KiwixPort = 8080,
        [int]$StartupTimeoutSeconds = 20,
        [int]$ShutdownTimeoutSeconds = 8,
        [int]$LogRetentionDays = 14,
        [bool]$OpenBrowser = $true,
        [bool]$EnableCrashCleanup = $true,
        [switch]$Force
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ((Test-Path -LiteralPath $fullPath) -and -not $Force) {
        throw "Launcher configuration already exists: $fullPath. Use -Force to replace it."
    }
    $parent = Split-Path -Parent $fullPath
    if (-not $parent) { throw 'The launcher configuration path must have a parent directory.' }
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    $stringValues = [ordered]@{
        RepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
        PythonExecutable = [System.IO.Path]::GetFullPath($PythonExecutable)
        FrontendDistPath = [System.IO.Path]::GetFullPath($FrontendDistPath)
        KiwixExecutable = [System.IO.Path]::GetFullPath($KiwixExecutable)
        CatalogPath = [System.IO.Path]::GetFullPath($CatalogPath)
        ZimPath = [System.IO.Path]::GetFullPath($ZimPath)
        ArchiveId = $ArchiveId
        BindAddress = '127.0.0.1'
        RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
    }
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('@{')
    $lines.Add('    SchemaVersion = 1')
    foreach ($entry in $stringValues.GetEnumerator()) {
        $lines.Add("    $($entry.Key) = $(ConvertTo-NocturnixDataFileString -Value $entry.Value)")
    }
    $lines.Add("    FrontendPort = $FrontendPort")
    $lines.Add("    BackendPort = $BackendPort")
    $lines.Add("    KiwixPort = $KiwixPort")
    $lines.Add("    StartupTimeoutSeconds = $StartupTimeoutSeconds")
    $lines.Add("    ShutdownTimeoutSeconds = $ShutdownTimeoutSeconds")
    $lines.Add("    LogRetentionDays = $LogRetentionDays")
    $lines.Add('    OpenBrowser = $' + $OpenBrowser.ToString().ToLowerInvariant())
    $lines.Add('    EnableCrashCleanup = $' + $EnableCrashCleanup.ToString().ToLowerInvariant())
    $lines.Add('}')

    $temporaryPath = Join-Path $parent ('.launcher.settings.{0}.psd1' -f [guid]::NewGuid().ToString('N'))
    try {
        Set-Content -LiteralPath $temporaryPath -Value $lines -Encoding utf8
        Import-NocturnixConfiguration -Path $temporaryPath | Out-Null
        Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force:$Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    return $fullPath
}

function Initialize-NocturnixJobObjectType {
    if ('Nocturnix.Runtime.KillOnCloseJob' -as [type]) { return }
    $source = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Nocturnix.Runtime
{
    public sealed class KillOnCloseJob : IDisposable
    {
        private IntPtr handle;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private enum JOBOBJECTINFOCLASS
        {
            JobObjectExtendedLimitInformation = 9
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            JOBOBJECTINFOCLASS infoClass,
            IntPtr info,
            uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public KillOnCloseJob(string name)
        {
            handle = CreateJobObject(IntPtr.Zero, name);
            if (handle == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed.");

            var information = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(information, pointer, false);
                if (!SetInformationJobObject(handle, JOBOBJECTINFOCLASS.JobObjectExtendedLimitInformation, pointer, (uint)length))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed.");
            }
            finally
            {
                Marshal.FreeHGlobal(pointer);
            }
        }

        public void AddProcess(int processId)
        {
            using (Process process = Process.GetProcessById(processId))
            {
                if (!AssignProcessToJobObject(handle, process.Handle))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed.");
            }
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                CloseHandle(handle);
                handle = IntPtr.Zero;
            }
            GC.SuppressFinalize(this);
        }

        ~KillOnCloseJob() { Dispose(); }
    }
}
'@
    Add-Type -TypeDefinition $source -Language CSharp
}

function New-NocturnixJobObject {
    param([Parameter(Mandatory)][string]$Name)
    Initialize-NocturnixJobObjectType
    return [Nocturnix.Runtime.KillOnCloseJob]::new($Name)
}

function Add-NocturnixProcessToJob {
    param(
        [Parameter(Mandatory)][object]$Job,
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process
    )
    $Job.AddProcess($Process.Id)
}

function ConvertTo-NocturnixArgument {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    if ($Value.Contains('"')) { throw 'Process arguments may not contain quote characters.' }
    if ($Value.Length -eq 0 -or $Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

function Initialize-NocturnixRuntimeContext {
    param([Parameter(Mandatory)][psobject]$Configuration, [Parameter(Mandatory)][string]$InstanceId)
    $logRoot = Join-Path $Configuration.RuntimeRoot 'logs'
    $stateRoot = Join-Path $Configuration.RuntimeRoot 'state'
    New-Item -ItemType Directory -Path $logRoot, $stateRoot -Force | Out-Null
    $cutoff = (Get-Date).AddDays(-$Configuration.LogRetentionDays)
    Get-ChildItem -LiteralPath $logRoot -Filter '*.log' -File -ErrorAction SilentlyContinue |
        Where-Object LastWriteTime -lt $cutoff |
        Remove-Item -Force -ErrorAction SilentlyContinue
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    return [pscustomobject]@{
        InstanceId = $InstanceId
        LogRoot = $logRoot
        StateRoot = $stateRoot
        SupervisorLog = Join-Path $logRoot "supervisor-$timestamp-$InstanceId.log"
        StatePath = Join-Path $stateRoot 'runtime.json'
        StopRequestPath = Join-Path $stateRoot 'stop.request.json'
        SessionTimestamp = $timestamp
    }
}

function Write-NocturnixLog {
    param(
        [Parameter(Mandatory)][psobject]$Context,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO',
        [Parameter(Mandatory)][string]$Message
    )
    $line = '{0} [{1}] {2}' -f (Get-Date).ToString('o'), $Level, $Message
    Add-Content -LiteralPath $Context.SupervisorLog -Value $line -Encoding utf8
    $color = if ($Level -eq 'ERROR') { 'Red' } elseif ($Level -eq 'WARN') { 'Yellow' } else { 'Cyan' }
    Write-Host $line -ForegroundColor $color
}

function New-NocturnixShutdownToken {
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToHexString($bytes)
}

function Write-NocturnixRuntimeState {
    param(
        [Parameter(Mandatory)][psobject]$Context,
        [Parameter(Mandatory)][psobject]$Configuration,
        [Parameter(Mandatory)][psobject]$SupervisorRecord,
        [Parameter(Mandatory)][string]$ShutdownToken,
        [Parameter(Mandatory)][AllowEmptyCollection()][array]$Services
    )
    $state = [ordered]@{
        SchemaVersion = 1
        InstanceId = $Context.InstanceId
        ShutdownToken = $ShutdownToken
        Supervisor = $SupervisorRecord
        BrowserUrl = $Configuration.FrontendOrigin + '/'
        Services = $Services
        UpdatedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $temporary = $Context.StatePath + '.' + $PID + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Context.StatePath -Force
}

function Read-NocturnixRuntimeState {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { throw "Runtime state is invalid: $($_.Exception.Message)" }
}

function Request-NocturnixShutdown {
    param(
        [Parameter(Mandatory)][psobject]$Context,
        [Parameter(Mandatory)][psobject]$State
    )
    $request = [ordered]@{
        InstanceId = [string]$State.InstanceId
        ShutdownToken = [string]$State.ShutdownToken
        RequestedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    $temporary = $Context.StopRequestPath + '.' + $PID + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($request | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Context.StopRequestPath -Force
}

function Test-NocturnixShutdownRequested {
    param(
        [Parameter(Mandatory)][psobject]$Context,
        [Parameter(Mandatory)][string]$InstanceId,
        [Parameter(Mandatory)][string]$ShutdownToken
    )
    if (-not (Test-Path -LiteralPath $Context.StopRequestPath -PathType Leaf)) { return $false }
    try {
        $request = Get-Content -LiteralPath $Context.StopRequestPath -Raw | ConvertFrom-Json
        $matches = $request.InstanceId -eq $InstanceId -and $request.ShutdownToken -eq $ShutdownToken
        Remove-Item -LiteralPath $Context.StopRequestPath -Force -ErrorAction SilentlyContinue
        return $matches
    }
    catch {
        Remove-Item -LiteralPath $Context.StopRequestPath -Force -ErrorAction SilentlyContinue
        return $false
    }
}

function Start-NocturnixOwnedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][psobject]$Service,
        [Parameter(Mandatory)][psobject]$Configuration,
        [Parameter(Mandatory)][psobject]$Context,
        [Parameter(Mandatory)][string]$InstanceId,
        [object]$Job
    )
    $arguments = @()
    $environment = @{ PYTHONUTF8 = '1'; PYTHONUNBUFFERED = '1' }
    switch ($Service.Name) {
        'Kiwix' {
            $arguments = @(
                '--address=127.0.0.1',
                "--port=$($Configuration.KiwixPort)",
                "--attachToProcess=$PID",
                '--blockexternal',
                $Configuration.ZimPath
            )
            $environment = @{}
        }
        'Backend' {
            $arguments = @('-m', 'manuals_api')
            $environment.NOCTURNIX_CATALOG_PATH = $Configuration.CatalogPath
            $environment.NOCTURNIX_KIWIX_BASE_URL = $Configuration.KiwixOrigin
            $environment.NOCTURNIX_KIWIX_ARCHIVE_ID = $Configuration.ArchiveId
            $environment.NOCTURNIX_API_PORT = [string]$Configuration.BackendPort
            $environment.NOCTURNIX_CORS_ORIGINS = $Configuration.FrontendOrigin
        }
        'Frontend' {
            $arguments = @('-m', 'manuals_api.web')
            $environment.NOCTURNIX_WEB_DIST_PATH = $Configuration.FrontendDistPath
            $environment.NOCTURNIX_WEB_PORT = [string]$Configuration.FrontendPort
            $environment.NOCTURNIX_WEB_ORIGIN = $Configuration.FrontendOrigin
        }
        default { throw "Unsupported service: $($Service.Name)" }
    }
    $stdout = Join-Path $Context.LogRoot "$($Service.Name.ToLowerInvariant())-$($Context.SessionTimestamp)-$InstanceId.out.log"
    $stderr = Join-Path $Context.LogRoot "$($Service.Name.ToLowerInvariant())-$($Context.SessionTimestamp)-$InstanceId.err.log"
    $argumentList = @($arguments | ForEach-Object { ConvertTo-NocturnixArgument -Value ([string]$_) })
    $startParameters = @{
        FilePath = $Service.ExecutablePath
        ArgumentList = $argumentList
        WorkingDirectory = $Service.WorkingDirectory
        Environment = $environment
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $stdout
        RedirectStandardError = $stderr
        PassThru = $true
    }
    $process = $null
    try {
        $process = Start-Process @startParameters
        if ($Job) { Add-NocturnixProcessToJob -Job $Job -Process $process }
        return [pscustomobject]@{
            Process = $process
            Record = New-NocturnixProcessRecord -Process $process -ServiceName $Service.Name -ExecutablePath $Service.ExecutablePath -InstanceId $InstanceId
            StandardOutputLog = $stdout
            StandardErrorLog = $stderr
        }
    }
    catch {
        $startFailure = $_
        if ($process) {
            try {
                $process.Refresh()
                if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
            }
            catch {}
        }
        throw $startFailure
    }
}

function Wait-NocturnixServiceReady {
    param(
        [Parameter(Mandatory)][psobject]$Service,
        [Parameter(Mandatory)][psobject]$Configuration,
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) { throw "$($Service.Name) exited with code $($Process.ExitCode) before becoming ready." }
        $probe = Invoke-NocturnixServiceProbe -Service $Service -Configuration $Configuration
        if ($probe.Healthy) { return $probe }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$($Service.Name) did not become ready within $TimeoutSeconds seconds."
}

function Stop-NocturnixOwnedProcesses {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][array]$ServiceRecords,
        [Parameter(Mandatory)][psobject]$Context,
        [int]$TimeoutSeconds = 8,
        [object]$Job
    )
    $records = @($ServiceRecords)
    [array]::Reverse($records)
    foreach ($entry in $records) {
        if (-not $entry.Owned) {
            Write-NocturnixLog -Context $Context -Message "$($entry.Service) was adopted and will remain running."
            continue
        }
        if (-not (Test-NocturnixProcessIdentity -Record $entry)) {
            Write-NocturnixLog -Context $Context -Level WARN -Message "$($entry.Service) process identity no longer matches; direct termination was skipped."
            continue
        }
        Write-NocturnixLog -Context $Context -Message "Stopping owned $($entry.Service) process $($entry.ProcessId)."
        Stop-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while ([DateTime]::UtcNow -lt $deadline -and (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 100
        }
    }
    if ($Job) { $Job.Dispose() }
}

function Invoke-NocturnixDefaultHttpRequest {
    param([string]$Uri, [int]$TimeoutSeconds)
    return Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSeconds -Headers @{ Accept = 'application/json' }
}

function Invoke-NocturnixServiceProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][psobject]$Service,
        [Parameter(Mandatory)][psobject]$Configuration,
        [scriptblock]$RequestInvoker = ${function:Invoke-NocturnixDefaultHttpRequest},
        [int]$TimeoutSeconds = 2
    )
    try {
        switch ($Service.ProbeKind) {
            'Frontend' {
                $response = & $RequestInvoker $Service.HealthUrl $TimeoutSeconds
                $body = $response.Content | ConvertFrom-Json
                $healthy = [int]$response.StatusCode -eq 200 -and $body.service -eq $script:FrontendIdentity -and $body.origin -eq $Configuration.FrontendOrigin
                if (-not $healthy) { throw 'Frontend identity did not match.' }
            }
            'Backend' {
                $response = & $RequestInvoker $Service.HealthUrl $TimeoutSeconds
                $body = $response.Content | ConvertFrom-Json
                $healthy = [int]$response.StatusCode -eq 200 -and $body.catalog_available -eq $true -and $body.kiwix_available -eq $true -and $body.archive_id -eq $Configuration.ArchiveId -and [int64]$body.guide_count -gt 0
                if (-not $healthy) { throw 'Backend identity or dependencies did not match.' }
            }
            'Kiwix' {
                $viewer = & $RequestInvoker $Service.ViewerUrl $TimeoutSeconds
                $content = & $RequestInvoker $Service.HealthUrl $TimeoutSeconds
                $healthy = [int]$viewer.StatusCode -eq 200 -and $viewer.Content -match '<title>ZIM Viewer</title>' -and [int]$content.StatusCode -eq 200
                if (-not $healthy) { throw 'Kiwix viewer or configured archive did not match.' }
            }
            default { throw "Unknown service probe kind: $($Service.ProbeKind)" }
        }
        return [pscustomobject]@{ Healthy = $true; Message = "$($Service.Name) is ready." }
    }
    catch {
        return [pscustomobject]@{ Healthy = $false; Message = "$($Service.Name) probe failed: $($_.Exception.Message)" }
    }
}

function Test-NocturnixTcpPort {
    param([string]$Address = '127.0.0.1', [int]$Port, [int]$TimeoutMilliseconds = 300)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($Address, $Port)
        return $task.Wait($TimeoutMilliseconds) -and $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

function Get-NocturnixServiceDisposition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][psobject]$Service,
        [Parameter(Mandatory)][psobject]$Configuration,
        [scriptblock]$RequestInvoker = ${function:Invoke-NocturnixDefaultHttpRequest},
        [scriptblock]$PortTester = { param($Address, $Port) Test-NocturnixTcpPort -Address $Address -Port $Port }
    )
    $probe = Invoke-NocturnixServiceProbe -Service $Service -Configuration $Configuration -RequestInvoker $RequestInvoker
    if ($probe.Healthy) {
        return [pscustomobject]@{ Action = 'Adopt'; Probe = $probe; Message = "$($Service.Name) is already healthy and will be adopted." }
    }
    if (& $PortTester '127.0.0.1' $Service.Port) {
        return [pscustomobject]@{ Action = 'Conflict'; Probe = $probe; Message = "Port $($Service.Port) is occupied by an unexpected or unhealthy service." }
    }
    return [pscustomobject]@{ Action = 'Start'; Probe = $probe; Message = "$($Service.Name) is not running and must be started." }
}

function New-NocturnixProcessRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$ExecutablePath,
        [Parameter(Mandatory)][string]$InstanceId,
        [bool]$Owned = $true
    )
    return [pscustomobject]@{
        Service = $ServiceName
        ProcessId = $Process.Id
        StartTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
        ExecutablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
        InstanceId = $InstanceId
        Owned = $Owned
    }
}

function Test-NocturnixProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory)][psobject]$Record)
    if (-not $Record.Owned) { return $false }
    try {
        $process = Get-Process -Id ([int]$Record.ProcessId) -ErrorAction Stop
        $actualPath = [System.IO.Path]::GetFullPath($process.Path)
        $expectedPath = [System.IO.Path]::GetFullPath([string]$Record.ExecutablePath)
        return $actualPath -ieq $expectedPath -and $process.StartTime.ToUniversalTime().Ticks -eq [int64]$Record.StartTimeUtcTicks
    }
    catch { return $false }
}

Export-ModuleMember -Function @(
    'Import-NocturnixConfiguration',
    'Write-NocturnixLocalConfiguration',
    'Invoke-NocturnixServiceProbe',
    'Get-NocturnixServiceDisposition',
    'Test-NocturnixTcpPort',
    'New-NocturnixProcessRecord',
    'Test-NocturnixProcessIdentity',
    'New-NocturnixJobObject',
    'Add-NocturnixProcessToJob',
    'Initialize-NocturnixRuntimeContext',
    'Write-NocturnixLog',
    'New-NocturnixShutdownToken',
    'Write-NocturnixRuntimeState',
    'Read-NocturnixRuntimeState',
    'Request-NocturnixShutdown',
    'Test-NocturnixShutdownRequested',
    'Start-NocturnixOwnedProcess',
    'Wait-NocturnixServiceReady',
    'Stop-NocturnixOwnedProcesses'
)

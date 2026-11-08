[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$KiwixExecutable,
    [Parameter(Mandatory)][string]$CatalogPath,
    [Parameter(Mandatory)][string]$ZimPath,
    [string]$ArchiveId = 'ifixit_en_all_2025-12',
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'launcher.settings.local.psd1'),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Nocturnix Manuals'),
    [int]$FrontendPort = 5173,
    [int]$BackendPort = 8765,
    [int]$KiwixPort = 8080,
    [switch]$NoBrowser,
    [switch]$SkipDependencyInstall,
    [switch]$SkipFrontendBuild,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Nocturnix initialization requires PowerShell 7 or newer.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$apiRoot = Join-Path $repositoryRoot 'services\manuals-api'
$webRoot = Join-Path $repositoryRoot 'apps\web'
$pythonExecutable = Join-Path $apiRoot '.venv\Scripts\python.exe'
$frontendDistPath = Join-Path $webRoot 'dist'
$modulePath = Join-Path $PSScriptRoot 'Nocturnix.Services.psm1'
Import-Module $modulePath -Force

$sourcePaths = [ordered]@{
    'Kiwix executable' = $KiwixExecutable
    'SQLite catalog' = $CatalogPath
    'ZIM archive' = $ZimPath
}
foreach ($source in $sourcePaths.GetEnumerator()) {
    if (-not [System.IO.Path]::IsPathRooted($source.Value) -or -not (Test-Path -LiteralPath $source.Value -PathType Leaf)) {
        throw "$($source.Key) must be an existing absolute file path: $($source.Value)"
    }
}

$protectedSources = @($KiwixExecutable, $CatalogPath, $ZimPath) | ForEach-Object {
    $file = Get-Item -LiteralPath $_
    [pscustomobject]@{ Path=$file.FullName; Length=$file.Length; LastWriteTimeUtc=$file.LastWriteTimeUtc }
}

foreach ($dailyService in @(
    [pscustomobject]@{ Name='frontend'; Port=$FrontendPort },
    [pscustomobject]@{ Name='catalog API'; Port=$BackendPort }
)) {
    if (Test-NocturnixTcpPort -Port $dailyService.Port) {
        throw "Initialization cannot run while the $($dailyService.Name) port $($dailyService.Port) is occupied. Stop the daily launcher or the unexpected port owner, then retry."
    }
}

try {
    if (-not $SkipDependencyInstall) {
        $uv = Get-Command uv -ErrorAction Stop
        Write-Host 'Installing the locked Python environment (initialization only)...' -ForegroundColor Cyan
        Push-Location $apiRoot
        try {
            & $uv.Source sync --frozen
            if ($LASTEXITCODE -ne 0) { throw "uv sync failed with exit code $LASTEXITCODE." }
        }
        finally { Pop-Location }

        $npm = Get-Command npm.cmd -ErrorAction Stop
        Write-Host 'Installing the locked frontend dependencies (initialization only)...' -ForegroundColor Cyan
        Push-Location $webRoot
        try {
            & $npm.Source ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
        }
        finally { Pop-Location }
    }

    if (-not $SkipFrontendBuild) {
        $npm = Get-Command npm.cmd -ErrorAction Stop
        Write-Host 'Building the local production frontend (initialization only)...' -ForegroundColor Cyan
        $previousBasePath = $env:VITE_BASE_PATH
        $previousApiUrl = $env:VITE_OFFLINE_GUIDES_API_URL
        try {
            $env:VITE_BASE_PATH = '/'
            $env:VITE_OFFLINE_GUIDES_API_URL = "http://127.0.0.1:$BackendPort"
            Push-Location $webRoot
            try {
                & $npm.Source run build:local
                if ($LASTEXITCODE -ne 0) { throw "The local frontend build failed with exit code $LASTEXITCODE." }
            }
            finally { Pop-Location }
        }
        finally {
            if ($null -eq $previousBasePath) { Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue } else { $env:VITE_BASE_PATH = $previousBasePath }
            if ($null -eq $previousApiUrl) { Remove-Item Env:VITE_OFFLINE_GUIDES_API_URL -ErrorAction SilentlyContinue } else { $env:VITE_OFFLINE_GUIDES_API_URL = $previousApiUrl }
        }
    }

    if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
        throw "The initialized Python executable was not found: $pythonExecutable"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $frontendDistPath 'index.html') -PathType Leaf)) {
        throw "The local frontend build was not found: $frontendDistPath"
    }

    $configurationParameters = @{
        Path = $ConfigPath
        RepositoryRoot = $repositoryRoot
        PythonExecutable = $pythonExecutable
        FrontendDistPath = $frontendDistPath
        KiwixExecutable = $KiwixExecutable
        CatalogPath = $CatalogPath
        ZimPath = $ZimPath
        ArchiveId = $ArchiveId
        RuntimeRoot = $RuntimeRoot
        FrontendPort = $FrontendPort
        BackendPort = $BackendPort
        KiwixPort = $KiwixPort
        OpenBrowser = -not $NoBrowser
        Force = $Force
    }
    $writtenPath = Write-NocturnixLocalConfiguration @configurationParameters
    Import-NocturnixConfiguration -Path $writtenPath | Out-Null
}
finally {
    foreach ($source in $protectedSources) {
        $current = Get-Item -LiteralPath $source.Path -ErrorAction Stop
        if ($current.Length -ne $source.Length -or $current.LastWriteTimeUtc -ne $source.LastWriteTimeUtc) {
            throw "Protected source metadata changed during initialization: $($source.Path)"
        }
    }
}

Write-Host 'Nocturnix Manuals initialization completed.' -ForegroundColor Green
Write-Host "Local configuration: $writtenPath"
Write-Host "Daily startup: $(Join-Path $PSScriptRoot 'Start Nocturnix Manuals.cmd')"

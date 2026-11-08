@{
    SchemaVersion = 1
    RepositoryRoot = 'C:\path\to\nocturnix-repair-manuals-github'
    PythonExecutable = 'C:\path\to\nocturnix-repair-manuals-github\services\manuals-api\.venv\Scripts\python.exe'
    FrontendDistPath = 'C:\path\to\nocturnix-repair-manuals-github\apps\web\dist'
    KiwixExecutable = 'C:\path\to\kiwix-serve.exe'
    CatalogPath = 'C:\path\to\repair_guides.db'
    ZimPath = 'C:\path\to\ifixit_en_all_2025-12.zim'
    ArchiveId = 'ifixit_en_all_2025-12'
    BindAddress = '127.0.0.1'
    FrontendPort = 5173
    BackendPort = 8765
    KiwixPort = 8080
    StartupTimeoutSeconds = 20
    ShutdownTimeoutSeconds = 8
    LogRetentionDays = 14
    OpenBrowser = $true
    EnableCrashCleanup = $true
    RuntimeRoot = 'C:\Users\YourName\AppData\Local\Nocturnix Manuals'
}

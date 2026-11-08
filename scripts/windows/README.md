# Nocturnix Manuals Windows launcher

The Windows launcher supervises three loopback-only services and keeps the
browser origin stable so the existing Dexie IndexedDB remains available:

- frontend: `http://127.0.0.1:5173`
- catalog API: `http://127.0.0.1:8765`
- Kiwix: `http://127.0.0.1:8080`

The PowerShell supervisor is authoritative. The CMD files are thin shortcuts
that make startup, shutdown, and restart convenient from Explorer. They do not
contain service lifecycle logic.

## One-time initialization

Install PowerShell 7, Node.js/npm, and `uv`, then run the initializer from a
PowerShell 7 prompt. Supply the existing files in their current locations:

```powershell
pwsh -NoProfile -File .\scripts\windows\Initialize-Nocturnix.ps1 `
  -KiwixExecutable 'D:\path\to\kiwix-serve.exe' `
  -CatalogPath 'D:\path\to\repair_guides.db' `
  -ZimPath 'D:\path\to\ifixit_en_all_2025-12.zim'
```

Initialization installs the locked Python and frontend dependencies, builds a
root-based local production frontend, and creates
`launcher.settings.local.psd1`. The settings file and generated frontend build
are ignored by Git. The initializer checks that the source executable, catalog,
and archive retain the same size and modification time; it never writes to
those files.

Use `-Force` only when intentionally replacing an existing local settings
file. Advanced/test-only `-SkipDependencyInstall` and `-SkipFrontendBuild`
options require the Python environment and production build to exist already.

## Daily operation

Double-click `Start Nocturnix Manuals.cmd`. After all HTTP identity checks pass,
the browser opens at `http://127.0.0.1:5173/`. Daily startup uses the prebuilt
frontend and does not invoke Node, npm, or Vite.

To stop, double-click `Stop Nocturnix Manuals.cmd`, or press Ctrl+C in the
supervisor window. `Restart Nocturnix Manuals.cmd` requests an authenticated
shutdown before starting again.

The supervisor:

- adopts already-running services only when their HTTP identity matches;
- rejects occupied ports with an unexpected or unhealthy service;
- starts dependencies in Kiwix, API, frontend order;
- stops only processes it started and whose PID, start time, and executable
  identity still match;
- never adds adopted processes to its kill-on-close Windows Job Object;
- uses Kiwix `--attachToProcess` plus a Job Object for verified crash cleanup.

Runtime state and logs default to
`%LOCALAPPDATA%\Nocturnix Manuals`. Paths and ports are configurable in the
ignored local settings file. Keep all addresses set to `127.0.0.1`; the
configuration validator rejects public binds. Logs contain operational status
and paths, so treat them as per-user local data.

## Troubleshooting

If startup reports an occupied port, identify or stop that application; the
launcher will not terminate it. A stale state file also does not authorize
process termination. Review the newest supervisor and service logs under the
configured runtime directory.

If initialization cannot replace the Python launcher on Windows, stop the old
catalog API first and rerun initialization. Package installation and frontend
rebuilds are deliberately separate from daily startup.

The local bridge is not a network service. An iPad or another computer has a
different localhost and cannot use these URLs.

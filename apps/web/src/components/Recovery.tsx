import { useState } from 'react'
import { restoreLegacyBackup } from '../database/libraryBackup'

export function Recovery() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  return (
    <main className="recovery-panel">
      <h1>Restore a v1 library backup</h1>
      <p>Use an empty browser profile or unused origin. Existing libraries are never overwritten.</p>
      <p>For a v0.2 rollback, restore here first, close this tab, then serve the v0.2 application at this exact origin.</p>
      <label>Backup file<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <button disabled={busy || !file} onClick={() => {
        if (!file) return
        setBusy(true)
        setMessage('Verifying backup…')
        void file.text().then((json) => restoreLegacyBackup(json)).then((count) => {
          setMessage(`Restored ${count} manuals with verified PDF hashes. Do not open v0.3 if you intend to return to v0.2.`)
        }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to restore backup.')).finally(() => setBusy(false))
      }}>{busy ? 'Restoring…' : 'Restore backup'}</button>
      {message && <p role="status">{message}</p>}
      <p><a href="/">Open v0.3 library</a></p>
    </main>
  )
}

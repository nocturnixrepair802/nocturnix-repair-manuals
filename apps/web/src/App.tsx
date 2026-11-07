import { useCallback, useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { BookOpen, FileText, FolderOpen, Search, Smartphone, Tablet, Watch, Upload } from 'lucide-react'
import {
  db, DEVICE_TYPES, MANUFACTURERS, DOCUMENT_CATEGORIES, POLICY_SECTIONS,
  type StoredManual, type ManualMetadata, type LibrarySection, type PolicySection,
} from './database/manualDatabase'
import { deleteManual, editManual, findLegacyDuplicates, importManual, prepareLibrary } from './database/manualLibrary'
import { createLegacyBackup, downloadBackup, hasLegacyLibrary } from './database/libraryBackup'
import { ManualCard } from './components/ManualCard'
import { ManualForm } from './components/ManualForm'
import { Modal } from './components/Modal'
import { PdfReader } from './components/PdfReader'
import { Recovery } from './components/Recovery'
import './App.css'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not be completed.'
}

function Library() {
  const [manuals, setManuals] = useState<StoredManual[]>([])
  const [stage, setStage] = useState<'checking' | 'backup' | 'loading' | 'ready' | 'error'>('checking')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [manufacturer, setManufacturer] = useState('All')
  const [deviceType, setDeviceType] = useState('All')
  const [category, setCategory] = useState('All')
  const [librarySection, setLibrarySection] = useState<LibrarySection>('Repair Manuals')
  const [policySection, setPolicySection] = useState<PolicySection | 'All'>('All')
  const [selectedManual, setSelectedManual] = useState<StoredManual | null>(null)
  const [editing, setEditing] = useState<StoredManual | null>(null)
  const [deleting, setDeleting] = useState<StoredManual | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupDownloaded, setBackupDownloaded] = useState(false)
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [queue, setQueue] = useState<File[]>([])
  const [results, setResults] = useState<string[]>([])

  const initialize = useCallback(async () => {
    setStage('loading')
    setError('')
    try {
      await prepareLibrary(db, (done, total) => setProgress(`Checking saved PDFs: ${done} of ${total}`))
      setStage('ready')
    } catch (cause) {
      setError(`Unable to prepare the library. ${errorMessage(cause)}`)
      setStage('error')
    }
  }, [])

  useEffect(() => {
    let active = true
    void hasLegacyLibrary().then(async (legacy) => {
      if (!active) return
      if (legacy) setStage('backup')
      else await initialize()
    }).catch((cause: unknown) => {
      if (active) { setError(errorMessage(cause)); setStage('error') }
    })
    return () => { active = false }
  }, [initialize])

  useEffect(() => {
    if (stage !== 'ready') return
    const subscription = liveQuery(() => db.manuals.toArray()).subscribe({
      next: setManuals,
      error: (cause: unknown) => { setError(errorMessage(cause)); setStage('error') },
    })
    return () => subscription.unsubscribe()
  }, [stage])

  const filteredManuals = useMemo(() => {
    const query = search.trim().toLowerCase()
    return manuals.filter((manual) => {
      const fields = [manual.title, manual.fileName, manual.manufacturer, manual.manualId,
        manual.deviceModel, manual.deviceModelId, manual.documentCategory,
        manual.librarySection, manual.policySection]
      return fields.some((field) => (field ?? '').toLowerCase().includes(query)) &&
        manual.librarySection === librarySection &&
        (librarySection === 'Policies, Procedures, & Operations'
          ? policySection === 'All' || manual.policySection === policySection
          : (manufacturer === 'All' || manual.manufacturer === manufacturer) &&
            (deviceType === 'All' || manual.deviceType === deviceType) &&
            (category === 'All' || manual.documentCategory === category))
    }).sort((a, b) => a.manualId.localeCompare(b.manualId, undefined, { numeric: true }))
  }, [manuals, search, manufacturer, deviceType, category, librarySection, policySection])

  const duplicateGroups = useMemo(() => findLegacyDuplicates(manuals), [manuals])
  const currentFile = queue[0]
  const importDefaults: ManualMetadata | null = currentFile ? {
    title: currentFile.name.replace(/\.pdf$/i, '').slice(0, 200) || 'Untitled manual',
    librarySection,
    policySection: librarySection === 'Policies, Procedures, & Operations'
      ? policySection === 'All' ? POLICY_SECTIONS[0] : policySection
      : '',
    manufacturer: librarySection === 'Repair Manuals'
      ? MANUFACTURERS.find((value) => value === manufacturer) ?? 'Unassigned'
      : '',
    deviceType: librarySection === 'Repair Manuals'
      ? DEVICE_TYPES.find((value) => value === deviceType) ?? 'Phone'
      : '',
    deviceModel: '', deviceModelId: '',
    documentCategory: librarySection === 'Repair Manuals'
      ? DOCUMENT_CATEGORIES.find((value) => value === category) ?? 'Unassigned'
      : '',
  } : null

  function skipImport() {
    setResults((previous) => [...previous, `${currentFile.name}: skipped.`])
    setQueue((previous) => previous.slice(1))
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><BookOpen size={28} /></div>
          <div><strong>NOCTURNIX</strong><span>REPAIR MANUALS</span></div>
        </div>
        <nav className="navigation library-sections" aria-label="Library sections">
          <button type="button" aria-pressed={librarySection === 'Repair Manuals'} onClick={() => {
            setLibrarySection('Repair Manuals'); setDeviceType('All'); setManufacturer('All'); setCategory('All')
          }}><BookOpen size={19} />Repair Manuals</button>
          <button type="button" aria-pressed={librarySection === 'Policies, Procedures, & Operations'} onClick={() => {
            setLibrarySection('Policies, Procedures, & Operations'); setPolicySection('All')
          }}><FolderOpen size={19} />Policies, Procedures, & Operations</button>
        </nav>
        <nav className="navigation subsection-navigation" aria-label={librarySection === 'Repair Manuals' ? 'Device types' : 'Policy subsections'}>
          {librarySection === 'Repair Manuals' ? [
            { value: 'All', label: 'All Manuals', Icon: FolderOpen },
            { value: 'Phone', label: 'Phones', Icon: Smartphone },
            { value: 'Tablet', label: 'Tablets', Icon: Tablet },
            { value: 'Watch', label: 'Watches', Icon: Watch },
          ].map(({ value, label, Icon }) => (
            <button key={value} type="button" aria-pressed={deviceType === value} onClick={() => setDeviceType(value)}>
              <Icon size={19} />{label}
            </button>
          )) : (
            <>
              <button type="button" aria-pressed={policySection === 'All'} onClick={() => setPolicySection('All')}>
                All Policy Documents <span className="nav-count">{manuals.filter((manual) => manual.librarySection === librarySection).length}</span>
              </button>
              {POLICY_SECTIONS.map((section) => (
                <button key={section} type="button" aria-pressed={policySection === section} onClick={() => setPolicySection(section)}>
                  {section}<span className="nav-count">{manuals.filter((manual) => manual.librarySection === librarySection && manual.policySection === section).length}</span>
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-footer">NMR Technical Library<span>Development Version 0.3</span></div>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">TECHNICAL REFERENCE LIBRARY</p>
            <h1>{librarySection}</h1>
            <p>{librarySection === 'Repair Manuals'
              ? 'Search, organize, and view your repair documentation.'
              : 'Organize your policies, procedures, and business operations documents.'}</p>
          </div>
          <label className={`upload-button ${stage !== 'ready' || queue.length ? 'disabled' : ''}`}>
            <Upload size={18} />Import PDF
            <input aria-label="Import PDF" type="file" accept=".pdf,application/pdf" multiple hidden
              disabled={stage !== 'ready' || queue.length > 0}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length) { setResults([]); setQueue(files); setError('') }
              }} />
          </label>
        </header>
        <section className="stats" aria-label="Library statistics">
          {[
            { label: 'Total Manuals', count: manuals.length, Icon: FileText },
            { label: 'Phone Manuals', count: manuals.filter((manual) => manual.deviceType === 'Phone').length, Icon: Smartphone },
            { label: 'Tablet Manuals', count: manuals.filter((manual) => manual.deviceType === 'Tablet').length, Icon: Tablet },
            { label: 'Watch Manuals', count: manuals.filter((manual) => manual.deviceType === 'Watch').length, Icon: Watch },
          ].map(({ label, count, Icon }) => (
            <div className="stat-card" key={label}><Icon /><div><strong>{count}</strong><span>{label}</span></div></div>
          ))}
        </section>
        {stage === 'backup' && (
          <section className="library-panel upgrade-panel" aria-label="Upgrade library">
            <h2>Back up your library before upgrading</h2>
            <p>Your existing manuals will be preserved. Close other library tabs, download the backup, and confirm that it is saved before upgrading to v0.3.</p>
            <p>This backup contains your PDF files. Keep it in a private location outside the repository.</p>
            <button disabled={busy} onClick={() => {
              setBusy(true); setError('')
              void createLegacyBackup().then((blob) => {
                downloadBackup(blob); setBackupDownloaded(true)
              }).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false))
            }}>{busy ? 'Verifying backup…' : 'Download v1 backup'}</button>
            <label className="backup-confirm"><input type="checkbox" disabled={!backupDownloaded || busy} checked={backupConfirmed} onChange={(event) => setBackupConfirmed(event.target.checked)} />I saved the backup in a private location.</label>
            <button className="primary" disabled={!backupConfirmed || busy} onClick={() => { void initialize() }}>Upgrade library</button>
          </section>
        )}
        <section className="library-panel">
          <div className="library-toolbar">
            <div className="search-box"><Search size={18} /><input type="search" placeholder={librarySection === 'Repair Manuals' ? 'Search repair manuals...' : 'Search policy documents...'} aria-label={`Search ${librarySection}`} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            {librarySection === 'Repair Manuals' && <>
              <select aria-label="Filter by manufacturer" value={manufacturer} onChange={(event) => setManufacturer(event.target.value)}>
                <option value="All">All Manufacturers</option>{MANUFACTURERS.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="Filter by device type" value={deviceType} onChange={(event) => setDeviceType(event.target.value)}>
                <option value="All">All Device Types</option>{DEVICE_TYPES.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="Filter by document category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="All">All Document Categories</option>{DOCUMENT_CATEGORIES.map((value) => <option key={value}>{value}</option>)}
              </select>
            </>}
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {stage === 'error' && <button onClick={() => window.location.reload()}>Retry library setup</button>}
          {results.length > 0 && <div role="status" className="import-results"><strong>Import results</strong><ul>{results.map((result, index) => <li key={index}>{result}</li>)}</ul></div>}
          {stage === 'ready' && duplicateGroups.length > 0 && (
            <details className="duplicate-notice">
              <summary>{duplicateGroups.length} duplicate PDF {duplicateGroups.length === 1 ? 'group' : 'groups'} preserved from the existing library</summary>
              <ul>{duplicateGroups.map((group) => <li key={group[0].fileHash}>{group.map((manual) => `${manual.manualId}: ${manual.title}`).join(' · ')}</li>)}</ul>
              <p>Review the entries and use Delete only for copies you choose to remove.</p>
            </details>
          )}
          {(stage === 'checking' || stage === 'loading') && <div className="empty-state" role="status"><BookOpen size={40} /><h2>Preparing library…</h2><p>{progress || 'Checking saved repair manuals.'}</p></div>}
          {stage === 'ready' && filteredManuals.length === 0 && <div className="empty-state"><BookOpen size={48} /><h2>{librarySection === 'Repair Manuals' ? 'No manuals found' : 'No policy documents found'}</h2><p>{manuals.filter((manual) => manual.librarySection === librarySection).length === 0
            ? librarySection === 'Repair Manuals' ? 'Import your first PDF repair manual to begin building the library.' : 'Import a policy or operations PDF to begin this library section.'
            : 'No documents match your current search or filters.'}</p></div>}
          {stage === 'ready' && filteredManuals.length > 0 && <div className="manual-grid">
            {filteredManuals.map((manual) => <ManualCard key={manual.id} manual={manual} onOpen={() => setSelectedManual(manual)} onEdit={() => setEditing(manual)} onDelete={() => { setError(''); setDeleting(manual) }} />)}
          </div>}
        </section>
      </main>
      {selectedManual && <PdfReader manual={selectedManual} onClose={() => setSelectedManual(null)} />}
      {editing && <Modal title={`Edit ${editing.manualId}`} onClose={() => { if (!busy) setEditing(null) }} busy={busy}>
        <p>{editing.fileName} · {editing.fileSize.toLocaleString()} bytes</p>
        <ManualForm initial={editing} onCancel={() => setEditing(null)} onSave={async (metadata) => {
          setBusy(true)
          try { await editManual(editing.id, metadata); setEditing(null) }
          finally { setBusy(false) }
        }} />
      </Modal>}
      {currentFile && importDefaults && <Modal title="Import manual" busy={busy} onClose={() => { if (!busy) skipImport() }}>
        <ManualForm key={currentFile.name + ':' + queue.length} initial={importDefaults} submitLabel="Import manual" onCancel={skipImport} onSave={async (metadata) => {
          setBusy(true)
          try {
            const result = await importManual(currentFile, metadata)
            setResults((previous) => [...previous, result.status === 'duplicate'
              ? `${currentFile.name}: duplicate of ${result.manual.manualId} (${result.manual.title}); skipped.`
              : `${currentFile.name}: imported as ${result.manual.manualId}.`])
            setQueue((previous) => previous.slice(1))
          } catch (cause) {
            setResults((previous) => [...previous, `${currentFile.name}: failed — ${errorMessage(cause)}`])
            throw cause
          } finally { setBusy(false) }
        }}><p>{currentFile.name} · {queue.length} {queue.length === 1 ? 'file' : 'files'} remaining. Cancel skips this file.</p></ManualForm>
      </Modal>}
      {deleting && <Modal title="Delete manual?" onClose={() => { if (!busy) setDeleting(null) }} busy={busy}>
        <p>Delete {deleting.manualId}: <strong>{deleting.title}</strong> and its PDF from this library? This cannot be undone.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
          <button className="danger" disabled={busy} onClick={() => {
            setBusy(true); setError('')
            void deleteManual(deleting.id).then(() => {
              if (selectedManual?.id === deleting.id) setSelectedManual(null)
              setDeleting(null)
            }).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false))
          }}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        </div>
      </Modal>}
    </div>
  )
}

export default function App() {
  return window.location.pathname === '/recovery' ? <Recovery /> : <Library />
}

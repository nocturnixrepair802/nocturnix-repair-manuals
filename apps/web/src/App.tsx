
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import {
  BookOpen,
  FileText,
  FolderOpen,
  Search,
  Smartphone,
  Tablet,
  Watch,
  Upload,
} from 'lucide-react'

import {
  db,
  type StoredManual,
  type DeviceType,
  type Manufacturer,
} from './database/manualDatabase'

import './App.css'

// ============================================================
// PDF READER
// ============================================================

function PdfReader({
  manual,
  onClose,
}: {
  manual: StoredManual
  onClose: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    const url = URL.createObjectURL(manual.file)

    if (iframe) {
      iframe.src = url
    }

    return () => {
      if (iframe) {
        iframe.removeAttribute('src')
      }

      URL.revokeObjectURL(url)
    }
  }, [manual.file])

  return (
    <div
      className="reader-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`PDF reader: ${manual.title}`}
    >
      <div className="reader-header">
        <strong>{manual.title}</strong>

        <button type="button" onClick={onClose}>
          Close Reader
        </button>
      </div>

      <iframe
        ref={iframeRef}
        title={manual.title}
      />
    </div>
  )
}

// ============================================================
// MAIN APPLICATION
// ============================================================

function App() {
  // ----------------------------------------------------------
  // APPLICATION STATE
  // ----------------------------------------------------------

  const [manuals, setManuals] = useState<StoredManual[]>([])

  const [search, setSearch] = useState('')
  const [manufacturer, setManufacturer] = useState('All')
  const [deviceType, setDeviceType] = useState('All')

  const [selectedManual, setSelectedManual] =
    useState<StoredManual | null>(null)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  // ----------------------------------------------------------
  // LOAD SAVED MANUALS FROM INDEXEDDB
  // ----------------------------------------------------------

  useEffect(() => {
    let active = true

    async function loadManuals() {
      try {
        const records = await db.manuals.toArray()

        if (active) {
          setManuals(records)
        }
      } catch (error) {
        console.error(
          'Unable to load saved manuals:',
          error,
        )

        if (active) {
          setImportError(
            'Unable to load the saved manual library.',
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadManuals()

    return () => {
      active = false
    }
  }, [])

  // ----------------------------------------------------------
  // SEARCH AND FILTER MANUALS
  // ----------------------------------------------------------

  const filteredManuals = useMemo(() => {
    const query = search.trim().toLowerCase()

    return manuals.filter((manual) => {
      const matchesSearch =
        manual.title.toLowerCase().includes(query) ||
        manual.fileName.toLowerCase().includes(query) ||
        manual.manufacturer.toLowerCase().includes(query)

      const matchesManufacturer =
        manufacturer === 'All' ||
        manual.manufacturer === manufacturer

      const matchesDeviceType =
        deviceType === 'All' ||
        manual.deviceType === deviceType

      return (
        matchesSearch &&
        matchesManufacturer &&
        matchesDeviceType
      )
    })
  }, [manuals, search, manufacturer, deviceType])

  // ----------------------------------------------------------
  // LIBRARY STATISTICS
  // ----------------------------------------------------------

  const totalManuals = manuals.length

  const phoneManuals = manuals.filter(
    (manual) => manual.deviceType === 'Phone',
  ).length

  const tabletManuals = manuals.filter(
    (manual) => manual.deviceType === 'Tablet',
  ).length

  const watchManuals = manuals.filter(
    (manual) => manual.deviceType === 'Watch',
  ).length

  // ----------------------------------------------------------
  // IMPORT PDF MANUALS
  // ----------------------------------------------------------

  async function importManuals(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? [])

    event.target.value = ''
    setImportError('')

    if (files.length === 0) {
      return
    }

    const pdfFiles = files.filter(
      (file) =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf'),
    )

    const skippedFiles =
      pdfFiles.length !== files.length

    if (pdfFiles.length === 0) {
      setImportError(
        'Only PDF files can be imported.',
      )
      return
    }

    // Until the metadata editor is implemented,
    // use the active filters as import defaults.

    const selectedManufacturer: Manufacturer =
      manufacturer === 'Apple' ||
      manufacturer === 'Samsung'
        ? manufacturer
        : 'Unassigned'

    const selectedDeviceType: DeviceType =
      deviceType === 'Tablet' ||
      deviceType === 'Watch'
        ? deviceType
        : 'Phone'

    const newManuals: StoredManual[] = pdfFiles.map(
      (file) => ({
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ''),
        manufacturer: selectedManufacturer,
        deviceType: selectedDeviceType,
        file,
        fileName: file.name,
        fileSize: file.size,
        importedAt: new Date().toISOString(),
      }),
    )

    setImporting(true)

    try {
      await db.manuals.bulkAdd(newManuals)

      const savedManuals =
        await db.manuals.toArray()

      setManuals(savedManuals)

      if (skippedFiles) {
        setImportError(
          'PDFs were imported, but unsupported files were skipped.',
        )
      }
    } catch (error) {
      console.error(
        'Unable to import PDFs:',
        error,
      )

      setImportError(
        'Unable to save one or more PDFs. Check available browser storage.',
      )

      try {
        const savedManuals =
          await db.manuals.toArray()

        setManuals(savedManuals)
      } catch (reloadError) {
        console.error(
          'Unable to reload saved manuals:',
          reloadError,
        )
      }
    } finally {
      setImporting(false)
    }
  }

  // ----------------------------------------------------------
  // PDF READER CONTROLS
  // ----------------------------------------------------------

  function openManual(manual: StoredManual) {
    setSelectedManual(manual)
  }

  function closeReader() {
    setSelectedManual(null)
  }

  // ----------------------------------------------------------
  // APPLICATION INTERFACE
  // ----------------------------------------------------------

  return (
    <div className="app-shell">
      {/* SIDEBAR */}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <BookOpen size={28} />
          </div>

          <div>
            <strong>NOCTURNIX</strong>
            <span>REPAIR MANUALS</span>
          </div>
        </div>

        <nav
          className="navigation"
          aria-label="Manual categories"
        >
          <button
            type="button"
            onClick={() => setDeviceType('All')}
          >
            <FolderOpen size={19} />
            All Manuals
          </button>

          <button
            type="button"
            onClick={() => setDeviceType('Phone')}
          >
            <Smartphone size={19} />
            Phones
          </button>

          <button
            type="button"
            onClick={() => setDeviceType('Tablet')}
          >
            <Tablet size={19} />
            Tablets
          </button>

          <button
            type="button"
            onClick={() => setDeviceType('Watch')}
          >
            <Watch size={19} />
            Watches
          </button>
        </nav>

        <div className="sidebar-footer">
          NMR Technical Library
          <span>Development Version 0.2</span>
        </div>
      </aside>

      {/* MAIN CONTENT */}

      <main className="main-content">
        {/* PAGE HEADER */}

        <header className="page-header">
          <div>
            <p className="eyebrow">
              TECHNICAL REFERENCE LIBRARY
            </p>

            <h1>Repair Manuals</h1>

            <p>
              Search, organize, and view your repair
              documentation.
            </p>
          </div>

          <label className="upload-button">
            <Upload size={18} />

            {importing
              ? 'Importing...'
              : 'Import PDF'}

            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              hidden
              disabled={importing || loading}
              onChange={(event) => {
                void importManuals(event)
              }}
            />
          </label>
        </header>

        {/* LIBRARY STATISTICS */}

        <section
          className="stats"
          aria-label="Library statistics"
        >
          <div className="stat-card">
            <FileText />

            <div>
              <strong>{totalManuals}</strong>
              <span>Total Manuals</span>
            </div>
          </div>

          <div className="stat-card">
            <Smartphone />

            <div>
              <strong>{phoneManuals}</strong>
              <span>Phone Manuals</span>
            </div>
          </div>

          <div className="stat-card">
            <Tablet />

            <div>
              <strong>{tabletManuals}</strong>
              <span>Tablet Manuals</span>
            </div>
          </div>

          <div className="stat-card">
            <Watch />

            <div>
              <strong>{watchManuals}</strong>
              <span>Watch Manuals</span>
            </div>
          </div>
        </section>

        {/* MANUAL LIBRARY */}

        <section className="library-panel">
          {/* SEARCH AND FILTERS */}

          <div className="library-toolbar">
            <div className="search-box">
              <Search size={18} />

              <input
                type="search"
                placeholder="Search repair manuals..."
                aria-label="Search repair manuals"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </div>

            <select
              aria-label="Filter by manufacturer"
              value={manufacturer}
              onChange={(event) =>
                setManufacturer(event.target.value)
              }
            >
              <option value="All">
                All Manufacturers
              </option>

              <option value="Apple">
                Apple
              </option>

              <option value="Samsung">
                Samsung
              </option>

              <option value="Unassigned">
                Unassigned
              </option>
            </select>

            <select
              aria-label="Filter by device type"
              value={deviceType}
              onChange={(event) =>
                setDeviceType(event.target.value)
              }
            >
              <option value="All">
                All Device Types
              </option>

              <option value="Phone">
                Phones
              </option>

              <option value="Tablet">
                Tablets
              </option>

              <option value="Watch">
                Watches
              </option>
            </select>
          </div>

          {/* IMPORT ERROR */}

          {importError && (
            <p
              role="alert"
              style={{ color: '#ffb4b4' }}
            >
              {importError}
            </p>
          )}

          {/* LOADING STATE */}

          {loading && (
            <div className="empty-state">
              <BookOpen size={40} />

              <h2>Loading library...</h2>

              <p>
                Retrieving saved repair manuals.
              </p>
            </div>
          )}

          {/* EMPTY LIBRARY */}

          {!loading &&
            filteredManuals.length === 0 && (
              <div className="empty-state">
                <BookOpen size={48} />

                <h2>No manuals found</h2>

                <p>
                  {manuals.length === 0
                    ? 'Import your first PDF repair manual to begin building the library.'
                    : 'No manuals match your current search or filters.'}
                </p>
              </div>
            )}

          {/* MANUAL CARDS */}

          {!loading &&
            filteredManuals.length > 0 && (
              <div className="manual-grid">
                {filteredManuals.map((manual) => (
                  <button
                    type="button"
                    className="manual-card"
                    key={manual.id}
                    onClick={() =>
                      openManual(manual)
                    }
                  >
                    <FileText size={30} />

                    <strong>
                      {manual.title}
                    </strong>

                    <span>
                      {manual.manufacturer}
                      {' · '}
                      {manual.deviceType}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </section>
      </main>

      {/* PDF READER OVERLAY */}

      {selectedManual && (
        <PdfReader
          key={selectedManual.id}
          manual={selectedManual}
          onClose={closeReader}
        />
      )}
    </div>
  )
}

export default App

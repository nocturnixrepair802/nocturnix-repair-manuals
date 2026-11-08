import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Database, RefreshCw, Search } from 'lucide-react'
import {
  fetchOfflineGuideFacets,
  fetchOfflineGuides,
  fetchOfflineGuideStatus,
  type OfflineGuideFacets,
  type OfflineGuideFilters,
  type OfflineGuidePage,
  type OfflineGuideStatus,
} from '../offlineGuides'
import { OfflineGuideCard } from './OfflineGuideCard'


const PAGE_SIZE = 50
const EMPTY_FILTERS: OfflineGuideFilters = {
  query: '', manufacturer: '', deviceModel: '', repairType: '', classificationStatus: '',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The local offline guide service could not be reached.'
}

export function OfflineGuides() {
  const [draftQuery, setDraftQuery] = useState('')
  const [filters, setFilters] = useState<OfflineGuideFilters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<OfflineGuidePage | null>(null)
  const [facets, setFacets] = useState<OfflineGuideFacets | null>(null)
  const [status, setStatus] = useState<OfflineGuideStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [serviceError, setServiceError] = useState('')
  const [reload, setReload] = useState(0)

  const retry = useCallback(() => {
    setServiceError('')
    setLoading(true)
    setReload((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetchOfflineGuideStatus(controller.signal),
      fetchOfflineGuideFacets(controller.signal),
    ]).then(([nextStatus, nextFacets]) => {
      setStatus(nextStatus)
      setFacets(nextFacets)
      if (!nextStatus.catalog_available) setServiceError(nextStatus.catalog_message)
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStatus(null)
      setFacets(null)
      setServiceError(errorMessage(error))
    })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    const controller = new AbortController()
    void fetchOfflineGuides(filters, PAGE_SIZE, offset, controller.signal).then((nextPage) => {
      setPage(nextPage)
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setPage(null)
      setServiceError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [filters, offset, reload])

  function updateFilter(key: keyof OfflineGuideFilters, value: string) {
    setLoading(true)
    setFilters((current) => ({ ...current, [key]: value }))
    setOffset(0)
  }

  function goToOffset(nextOffset: number) {
    setLoading(true)
    setOffset(nextOffset)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    updateFilter('query', draftQuery)
  }

  const start = page && page.total ? page.offset + 1 : 0
  const end = page ? Math.min(page.offset + page.items.length, page.total) : 0

  return (
    <section className="offline-guides" aria-label="Offline Repair Guides">
      <div className="offline-context">
        <Database size={22} />
        <div>
          <strong>Local iFixit archive</strong>
          <p>This catalog and Kiwix viewer are available only on the Windows computer running the local services. An iPad or another computer has a different localhost.</p>
        </div>
      </div>
      {serviceError && (
        <div className="service-notice error" role="alert">
          <AlertTriangle size={20} />
          <div><strong>Offline guide service unavailable</strong><p>{serviceError} Start the local Nocturnix guide API on this computer and retry.</p></div>
          <button type="button" onClick={retry}><RefreshCw size={16} />Retry</button>
        </div>
      )}
      {status && !status.kiwix_available && (
        <div className="service-notice warning" role="status">
          <AlertTriangle size={20} />
          <div><strong>Kiwix viewer unavailable</strong><p>{status.kiwix_message}</p></div>
          <button type="button" onClick={retry}><RefreshCw size={16} />Retry</button>
        </div>
      )}
      {status?.catalog_available && (
        <div className="offline-guide-summary">
          <strong>{status.guide_count?.toLocaleString()} indexed guides</strong>
          <span>{status.kiwix_available ? 'Kiwix connected' : 'Catalog available; viewer disconnected'}</span>
        </div>
      )}
      <div className="library-panel offline-guide-panel">
        <form className="offline-guide-search" role="search" onSubmit={search}>
          <label className="search-box">
            <Search size={18} />
            <input aria-label="Search offline repair guides" type="search" value={draftQuery}
              placeholder="Search title, manufacturer, model, or repair type…"
              maxLength={200} onChange={(event) => setDraftQuery(event.target.value)} />
          </label>
          <button type="submit">Search</button>
        </form>
        <div className="offline-guide-filters">
          <label>Manufacturer<select aria-label="Filter offline guides by manufacturer" value={filters.manufacturer}
            onChange={(event) => updateFilter('manufacturer', event.target.value)}>
            <option value="">All manufacturers</option>
            {facets?.manufacturers.map((facet) => <option key={facet.value} value={facet.value}>{facet.label} ({facet.count.toLocaleString()})</option>)}
          </select></label>
          <label>Device model<select aria-label="Filter offline guides by device model" value={filters.deviceModel}
            onChange={(event) => updateFilter('deviceModel', event.target.value)}>
            <option value="">All device models</option>
            {facets?.device_models.map((facet) => <option key={facet.value} value={facet.value}>{facet.label} ({facet.count.toLocaleString()})</option>)}
          </select></label>
          <label>Repair type<select aria-label="Filter offline guides by repair type" value={filters.repairType}
            onChange={(event) => updateFilter('repairType', event.target.value)}>
            <option value="">All repair types</option>
            {facets?.repair_types.map((facet) => <option key={facet.value} value={facet.value}>{facet.label} ({facet.count.toLocaleString()})</option>)}
          </select></label>
          <label>Classification<select aria-label="Filter offline guides by classification" value={filters.classificationStatus}
            onChange={(event) => updateFilter('classificationStatus', event.target.value)}>
            <option value="">All classifications</option>
            {facets?.classification_statuses.map((facet) => <option key={facet.value} value={facet.value}>{facet.label} ({facet.count.toLocaleString()})</option>)}
          </select></label>
        </div>
        {loading && <div className="empty-state" role="status"><RefreshCw className="spin" size={32} /><h2>Searching offline guides…</h2></div>}
        {!loading && page && page.items.length === 0 && <div className="empty-state"><Search size={42} /><h2>No offline guides found</h2><p>Try a different search or filter combination.</p></div>}
        {!loading && page && page.items.length > 0 && <>
          <div className="offline-guide-results-heading" aria-live="polite">Showing {start.toLocaleString()}–{end.toLocaleString()} of {page.total.toLocaleString()} guides</div>
          <div className="offline-guide-grid">
            {page.items.map((guide) => <OfflineGuideCard key={guide.guide_id} guide={guide} kiwixAvailable={status?.kiwix_available === true} />)}
          </div>
          <div className="pagination" aria-label="Offline guide pages">
            <button type="button" disabled={offset === 0} onClick={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <span>{start.toLocaleString()}–{end.toLocaleString()} of {page.total.toLocaleString()}</span>
            <button type="button" disabled={offset + page.items.length >= page.total} onClick={() => goToOffset(offset + PAGE_SIZE)}>Next</button>
          </div>
        </>}
      </div>
    </section>
  )
}

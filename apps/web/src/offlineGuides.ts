export const DEFAULT_OFFLINE_GUIDES_API_URL = 'http://127.0.0.1:8765'
export const MISSING_FACET_VALUE = '__missing__'

export interface OfflineGuide {
  guide_id: string
  title: string
  archive_path: string
  manufacturer: string | null
  device_family: string | null
  device_model: string | null
  repair_type: string | null
  source: string
  archive_version: string
  classification_status: 'Needs Review' | 'Auto-Classified'
  viewer_url: string
}

export interface OfflineGuidePage {
  items: OfflineGuide[]
  total: number
  limit: number
  offset: number
}

export interface FacetValue {
  value: string
  label: string
  count: number
}

export interface OfflineGuideFacets {
  manufacturers: FacetValue[]
  device_models: FacetValue[]
  repair_types: FacetValue[]
  classification_statuses: FacetValue[]
}

export interface OfflineGuideStatus {
  catalog_available: boolean
  catalog_message: string
  guide_count: number | null
  kiwix_available: boolean
  kiwix_message: string
  kiwix_base_url: string
  archive_id: string
}

export interface OfflineGuideFilters {
  query: string
  manufacturer: string
  deviceModel: string
  repairType: string
  classificationStatus: string
}

export function resolveOfflineGuidesApiUrl(
  configured = import.meta.env.VITE_OFFLINE_GUIDES_API_URL || DEFAULT_OFFLINE_GUIDES_API_URL,
) {
  const url = new URL(configured)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('The offline guide API must use an HTTP loopback address.')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The offline guide API URL must contain only its loopback origin.')
  }
  return url.origin
}

export function buildOfflineGuideRequestUrl(
  filters: OfflineGuideFilters,
  limit: number,
  offset: number,
  apiUrl = resolveOfflineGuidesApiUrl(),
) {
  const parameters = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (filters.query.trim()) parameters.set('query', filters.query.trim())
  if (filters.manufacturer) parameters.set('manufacturer', filters.manufacturer)
  if (filters.deviceModel) parameters.set('device_model', filters.deviceModel)
  if (filters.repairType) parameters.set('repair_type', filters.repairType)
  if (filters.classificationStatus) parameters.set('classification_status', filters.classificationStatus)
  return `${apiUrl}/api/offline-guides?${parameters}`
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('The local offline guide service could not be reached.', { cause: error })
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json() as { detail?: string }
      detail = body.detail ?? ''
    } catch {
      // The local service may return a response without JSON details.
    }
    throw new Error(detail || `The offline guide service returned HTTP ${response.status}.`)
  }
  return response.json() as Promise<T>
}

export function fetchOfflineGuideStatus(signal?: AbortSignal) {
  return fetchJson<OfflineGuideStatus>(
    `${resolveOfflineGuidesApiUrl()}/api/offline-guides/status`,
    signal,
  )
}

export function fetchOfflineGuideFacets(signal?: AbortSignal) {
  return fetchJson<OfflineGuideFacets>(
    `${resolveOfflineGuidesApiUrl()}/api/offline-guides/facets`,
    signal,
  )
}

export function fetchOfflineGuides(
  filters: OfflineGuideFilters,
  limit: number,
  offset: number,
  signal?: AbortSignal,
) {
  return fetchJson<OfflineGuidePage>(buildOfflineGuideRequestUrl(filters, limit, offset), signal)
}

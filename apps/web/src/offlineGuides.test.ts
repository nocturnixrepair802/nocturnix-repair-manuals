import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOfflineGuideRequestUrl,
  fetchOfflineGuides,
  resolveOfflineGuidesApiUrl,
  type OfflineGuideFilters,
} from './offlineGuides'


const filters: OfflineGuideFilters = {
  query: 'iPhone 15',
  manufacturer: 'Apple',
  deviceModel: 'iPhone 15',
  repairType: 'Back Glass',
  classificationStatus: 'Auto-Classified',
}

afterEach(() => vi.restoreAllMocks())

describe('offline guide API client', () => {
  it('constructs API queries without changing filter text', () => {
    const url = new URL(buildOfflineGuideRequestUrl(filters, 50, 100, 'http://127.0.0.1:8765'))
    expect(url.origin).toBe('http://127.0.0.1:8765')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      offset: '100',
      query: 'iPhone 15',
      manufacturer: 'Apple',
      device_model: 'iPhone 15',
      repair_type: 'Back Glass',
      classification_status: 'Auto-Classified',
    })
  })

  it('preserves the exact Kiwix URL returned by the local API', async () => {
    const verifiedUrl = 'http://127.0.0.1:8080/viewer#ifixit_en_all_2025-12/Guide/(New)+iPhone+15+Back+Glass+Installation/191628'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        guide_id: '191628', title: '(New) iPhone 15 Back Glass Installation',
        archive_path: 'Guide/(New)+iPhone+15+Back+Glass+Installation/191628',
        manufacturer: 'Apple', device_family: 'iPhone', device_model: 'iPhone 15',
        repair_type: 'Back Glass', source: 'iFixit', archive_version: '2025-12',
        classification_status: 'Auto-Classified', viewer_url: verifiedUrl,
      }],
      total: 1, limit: 50, offset: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const page = await fetchOfflineGuides(filters, 50, 0)
    expect(page.items[0].viewer_url).toBe(verifiedUrl)
  })

  it('refuses a non-loopback API origin', () => {
    expect(() => resolveOfflineGuidesApiUrl('https://guides.example.com')).toThrow('loopback')
  })
})

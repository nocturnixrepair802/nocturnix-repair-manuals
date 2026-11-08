import { ExternalLink, Wrench } from 'lucide-react'
import type { OfflineGuide } from '../offlineGuides'


export function OfflineGuideCard({ guide, kiwixAvailable }: {
  guide: OfflineGuide
  kiwixAvailable: boolean
}) {
  const automaticallyClassified = guide.classification_status === 'Auto-Classified'
  return (
    <article className="offline-guide-card" aria-label={`${guide.guide_id}: ${guide.title}`}>
      <div className="offline-guide-card-heading">
        <Wrench size={24} />
        <span className={`classification-badge ${automaticallyClassified ? 'auto-classified' : 'needs-review'}`}>
          {guide.classification_status}
        </span>
      </div>
      <span className="manual-id">iFixit Guide {guide.guide_id}</span>
      <h2>{guide.title}</h2>
      <dl className="guide-metadata">
        <div><dt>Manufacturer</dt><dd>{guide.manufacturer || 'Unassigned'}</dd></div>
        <div><dt>Device model</dt><dd>{guide.device_model || 'Unassigned'}</dd></div>
        <div><dt>Repair type</dt><dd>{guide.repair_type || 'Unassigned'}</dd></div>
      </dl>
      <p className="classification-note">{automaticallyClassified
        ? 'Automatically classified metadata; verify it against the guide before relying on it.'
        : 'Metadata needs review and may be incomplete.'}</p>
      <p className="guide-attribution">Source: {guide.source} · Offline archive {guide.archive_version}</p>
      {kiwixAvailable ? (
        <a className="open-guide-link" href={guide.viewer_url} target="_blank" rel="noreferrer">
          Open in Kiwix <ExternalLink size={16} />
        </a>
      ) : (
        <button type="button" className="open-guide-link disabled" disabled>Kiwix unavailable</button>
      )}
    </article>
  )
}

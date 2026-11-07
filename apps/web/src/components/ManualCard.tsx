import { FileText } from 'lucide-react'
import type { StoredManual } from '../database/manualDatabase'

export function ManualCard({ manual, onOpen, onEdit, onDelete }: {
  manual: StoredManual
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className="manual-card" aria-label={`${manual.manualId}: ${manual.title}`}>
      <button type="button" className="manual-open" onClick={onOpen} aria-label={`Open ${manual.title}`}>
        <FileText size={30} />
        <span className="manual-id">{manual.manualId}</span>
        <strong>{manual.title}</strong>
        {manual.librarySection === 'Policies, Procedures, & Operations' ? (
          <span>{manual.policySection}</span>
        ) : (
          <>
            <span>{manual.manufacturer} · {manual.deviceType}</span>
            <span>{manual.deviceModel || 'Model unassigned'}{manual.deviceModelId && ` (${manual.deviceModelId})`}</span>
            <span>{manual.documentCategory}</span>
          </>
        )}
      </button>
      <div className="card-actions">
        <button type="button" onClick={onEdit} aria-label={`Edit ${manual.title}`}>Edit</button>
        <button type="button" className="danger" onClick={onDelete} aria-label={`Delete ${manual.title}`}>Delete</button>
      </div>
    </article>
  )
}

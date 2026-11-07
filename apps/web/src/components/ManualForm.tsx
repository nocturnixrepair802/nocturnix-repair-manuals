import { useId, useState, type FormEvent, type ReactNode } from 'react'
import {
  DEVICE_TYPES, DOCUMENT_CATEGORIES, LIBRARY_SECTIONS, MANUFACTURERS, POLICY_SECTIONS,
  type ManualMetadata,
} from '../database/manualDatabase'
import { validateMetadata } from '../database/manualLibrary'

export function ManualForm({ initial, onSave, onCancel, submitLabel = 'Save changes', children }: {
  initial: ManualMetadata
  onSave: (metadata: ManualMetadata) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  children?: ReactNode
}) {
  const formId = useId()
  const [metadata, setMetadata] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await onSave(validateMetadata(metadata)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this manual.') }
    finally { setBusy(false) }
  }
  return (
    <form onSubmit={(event) => { void submit(event) }}>
      {children}
      <fieldset disabled={busy} className="metadata-fields">
        <label>Title<input required maxLength={200} value={metadata.title} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} /></label>
        <div className="form-field"><label htmlFor={`${formId}-library-section`}>Library section</label><select id={`${formId}-library-section`} value={metadata.librarySection} onChange={(event) => {
          const librarySection = event.target.value as ManualMetadata['librarySection']
          setMetadata({
            ...metadata,
            librarySection,
            policySection: librarySection === 'Policies, Procedures, & Operations' ? POLICY_SECTIONS[0] : '',
            manufacturer: librarySection === 'Repair Manuals' ? 'Unassigned' : '',
            deviceType: librarySection === 'Repair Manuals' ? 'Phone' : '',
            documentCategory: librarySection === 'Repair Manuals' ? 'Unassigned' : '',
          })
        }}>
          {LIBRARY_SECTIONS.map((value) => <option key={value}>{value}</option>)}
        </select></div>
        {metadata.librarySection === 'Policies, Procedures, & Operations' ? (
          <div className="form-field"><label htmlFor={`${formId}-policy-section`}>Policy subsection</label><select id={`${formId}-policy-section`} value={metadata.policySection} onChange={(event) => setMetadata({ ...metadata, policySection: event.target.value as ManualMetadata['policySection'] })}>
            {POLICY_SECTIONS.map((value) => <option key={value}>{value}</option>)}
          </select></div>
        ) : (
          <>
            <div className="form-field"><label htmlFor={`${formId}-manufacturer`}>Manufacturer</label><select id={`${formId}-manufacturer`} value={metadata.manufacturer} onChange={(event) => setMetadata({ ...metadata, manufacturer: event.target.value as ManualMetadata['manufacturer'] })}>
              {MANUFACTURERS.map((value) => <option key={value}>{value}</option>)}
            </select></div>
            <div className="form-field"><label htmlFor={`${formId}-device-type`}>Device type</label><select id={`${formId}-device-type`} value={metadata.deviceType} onChange={(event) => setMetadata({ ...metadata, deviceType: event.target.value as ManualMetadata['deviceType'] })}>
              {DEVICE_TYPES.map((value) => <option key={value}>{value}</option>)}
            </select></div>
            <label>Device model<input maxLength={120} placeholder="e.g. iPhone 14" value={metadata.deviceModel} onChange={(event) => setMetadata({ ...metadata, deviceModel: event.target.value })} /></label>
            <label>DeviceModelID<input maxLength={120} placeholder="e.g. A2649 or SM-S901B" value={metadata.deviceModelId} onChange={(event) => setMetadata({ ...metadata, deviceModelId: event.target.value })} /></label>
            <div className="form-field"><label htmlFor={`${formId}-category`}>Document category</label><select id={`${formId}-category`} value={metadata.documentCategory} onChange={(event) => setMetadata({ ...metadata, documentCategory: event.target.value as ManualMetadata['documentCategory'] })}>
              {DOCUMENT_CATEGORIES.map((value) => <option key={value}>{value}</option>)}
            </select></div>
          </>
        )}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}

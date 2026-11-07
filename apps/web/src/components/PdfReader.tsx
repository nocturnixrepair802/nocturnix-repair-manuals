import { useEffect, useRef } from 'react'
import type { StoredManual } from '../database/manualDatabase'
import { Modal } from './Modal'

export function PdfReader({ manual, onClose }: { manual: StoredManual; onClose: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(manual.file)
    const iframe = iframeRef.current
    if (iframe) iframe.src = objectUrl
    return () => {
      iframe?.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [manual.file])
  return (
    <Modal title={`PDF reader: ${manual.title}`} onClose={onClose}>
      <div className="reader-header">
        <strong>{manual.manualId}</strong>
        <button type="button" onClick={onClose}>Close Reader</button>
      </div>
      <iframe ref={iframeRef} title={manual.title} />
    </Modal>
  )
}

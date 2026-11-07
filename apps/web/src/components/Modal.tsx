import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={(event) => {
      event.preventDefault()
      if (!busy) onClose()
    }}>
      <h2>{title}</h2>
      {children}
    </dialog>
  )
}

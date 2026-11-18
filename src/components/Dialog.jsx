import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function Dialog({ title, leading = null, headerActions = null, children, onClose, className = '' }) {
  const panel = useRef(), close = useRef(onClose), heading = useId()
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow, root = document.getElementById('root'), wasInert = root?.inert
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    panel.current.focus()
    function key(event) {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')]
      if (dialogs.at(-1) !== panel.current) return
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key === 'Tab') {
        const nodes = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"],a[href]')].filter(n => n.getClientRects().length)
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; if (root) root.inert = wasInert; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus({preventScroll:true}) }
  }, [])
  return createPortal(<div className={`modal-backdrop ${className}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={heading}><div className="modal-header"><div className="modal-header-main">{leading}<h2 id={heading}>{title}</h2></div><div className="modal-header-actions">{headerActions}<button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={18}/></button></div></div>{children}</section></div>, document.body)
}

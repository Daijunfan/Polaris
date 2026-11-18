import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const minimum = 200, maximum = 480, defaultWidth = 260
const bounded = value => Math.max(minimum, Math.min(maximum, value))
const available = () => Math.max(minimum, Math.min(maximum, window.innerWidth - 480))

export default function SidebarPane({ children, collapsed, open, onCollapse }) {
  const [width, setWidth] = useState(() => {
    try { return bounded(Number(localStorage.getItem('mentor-sidebar-width')) || defaultWidth) }
    catch { return defaultWidth }
  })
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const panel = useRef(), handle = useRef(), drag = useRef(null), frame = useRef(null)
  function apply(value) { panel.current.style.setProperty('--sidebar-width', `${value}px`) }
  function commit(value) {
    apply(value); setWidth(value)
    try { localStorage.setItem('mentor-sidebar-width', String(value)) } catch { /* Layout remains usable without storage. */ }
  }
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)'), change = () => setMobile(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useLayoutEffect(() => {
    const measure = () => {
      const value=drag.current?panel.current.getBoundingClientRect().width:width
      handle.current.setAttribute('aria-valuenow', String(Math.max(minimum,Math.min(available(),Math.round(value)))))
      handle.current.setAttribute('aria-valuemax', String(available()))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(panel.current); measure()
    window.addEventListener('resize',measure)
    return () => {observer.disconnect();window.removeEventListener('resize',measure)}
  }, [width])
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    document.documentElement.classList.remove('resizing-sidebar')
  }, [])
  function start(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const size = panel.current.getBoundingClientRect().width
    drag.current = { pointer: event.pointerId, x: event.clientX, width: size, next: size }
    panel.current.dataset.resizing = 'true'
    document.documentElement.classList.add('resizing-sidebar')
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    current.next = Math.max(minimum, Math.min(available(), current.width + event.clientX - current.x))
    if (frame.current != null) return
    frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) apply(drag.current.next) })
  }
  function finish(event) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    cancelAnimationFrame(frame.current); frame.current = null
    commit(current.next)
    // Settle the last pointer position before restoring the collapse animation.
    panel.current.getBoundingClientRect()
    delete panel.current.dataset.resizing
    document.documentElement.classList.remove('resizing-sidebar')
    if (handle.current.hasPointerCapture(event.pointerId)) handle.current.releasePointerCapture(event.pointerId)
  }
  function keyboard(event) {
    let next, current = Math.min(width,available()), step = event.shiftKey ? 64 : 16
    if (event.key === 'ArrowLeft') next = current - step
    if (event.key === 'ArrowRight') next = current + step
    if (event.key === 'Home') next = minimum
    if (event.key === 'End') next = available()
    if (event.key === 'Enter') { event.preventDefault(); onCollapse(); return }
    if (next != null) { event.preventDefault(); commit(Math.max(minimum, Math.min(available(), next))) }
  }
  return <div ref={panel} className={`sidebar-pane${collapsed ? ' is-collapsed' : ''}${open ? ' mobile-open' : ''}`} style={{ '--sidebar-width': `${width}px` }}>
    <div id="sidebar-content" className="sidebar-viewport" inert={mobile ? !open : collapsed}>{children}</div>
    <div ref={handle} className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls="sidebar-content" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} tabIndex={collapsed || mobile ? -1 : 0} title="拖动调整宽度，双击还原" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDoubleClick={() => commit(Math.min(defaultWidth, available()))} onKeyDown={keyboard}/>
  </div>
}

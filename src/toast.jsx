import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, Info, X } from 'lucide-react'

const noop = () => {}
const fallbackToast = { toasts: [], push: noop, success: noop, info: noop, error: noop, dismiss: noop, clear: noop }
const ToastContext = createContext(fallbackToast)

export const useToast = () => useContext(ToastContext) || fallbackToast

function ToastItem({ toast, isMac, onDismiss }) {
  const Icon = toast.tone === 'error' ? AlertCircle : toast.tone === 'info' ? Info : Check
  return (
    <div
      className={`notice toast-item tone-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={15} className="toast-icon" aria-hidden="true" />
      <span className="toast-text">{toast.text}</span>
      {toast.desktopSavedPath && window.polarisDesktop?.showItemInFolder && (
        <button
          type="button"
          className="toast-action"
          onClick={() => window.polarisDesktop.showItemInFolder(toast.desktopSavedPath)}
        >
          {isMac ? '在访达中显示' : '在文件夹中显示'}
        </button>
      )}
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onDismiss(toast.id)
            toast.onAction()
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="关闭提示"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const seq = useRef(0)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

  const clearTimer = useCallback(id => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const dismiss = useCallback(id => {
    clearTimer(id)
    setToasts(prev => prev.filter(item => item.id !== id))
  }, [clearTimer])

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setToasts([])
  }, [])

  const scheduleDismiss = useCallback((id, durationMs) => {
    clearTimer(id)
    if (durationMs > 0) {
      const timer = setTimeout(() => {
        timers.current.delete(id)
        setToasts(prev => prev.filter(item => item.id !== id))
      }, durationMs)
      timers.current.set(id, timer)
    }
  }, [clearTimer])

  const push = useCallback(({ tone = 'success', text, actionLabel = '', onAction = null, desktopSavedPath = '', durationMs = 4500 } = {}) => {
    const cleanText = String(text || '').trim()
    if (!cleanText) return null
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    const targetId = `toast-${++seq.current}`
    setToasts([{ id: targetId, tone, text: cleanText, actionLabel, onAction, desktopSavedPath, durationMs }])
    scheduleDismiss(targetId, durationMs)
    return targetId
  }, [scheduleDismiss])

  const success = useCallback((text, opts = {}) => push({ ...opts, tone: 'success', text }), [push])
  const info = useCallback((text, opts = {}) => push({ ...opts, tone: 'info', text }), [push])
  const error = useCallback((text, opts = {}) => push({ ...opts, tone: 'error', durationMs: opts.durationMs ?? 6000, text }), [push])

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  const value = useMemo(() => ({ toasts, push, success, info, error, dismiss, clear }), [toasts, push, success, info, error, dismiss, clear])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && toasts.length > 0 && createPortal(
        <div className="toast-stack" role="region" aria-label="通知提示">
          {toasts.map(item => (
            <ToastItem key={item.id} toast={item} isMac={isMac} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

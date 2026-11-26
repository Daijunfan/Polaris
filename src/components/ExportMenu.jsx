import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Bookmark, Check, ChevronDown, Download, FileCode2, FileSpreadsheet, FileText, LoaderCircle, Sparkles } from 'lucide-react'
import { exportFile } from '../api.js'

const FORMAT_OPTIONS = [
  { id: 'xlsx', label: 'Excel 表格', ext: '.xlsx', desc: '多工作表、冻结表头，可直接筛选', Icon: FileSpreadsheet },
  { id: 'pdf', label: 'PDF 报告', ext: '.pdf', desc: '排版精美，适合打印与分享阅读', Icon: FileText },
  { id: 'docx', label: 'Word 文档', ext: '.docx', desc: '结构化报告，方便二次编辑批注', Icon: FileText },
  { id: 'md', label: 'Markdown 文档', ext: '.md', desc: '轻量纯文本笔记，适合长期归档', Icon: FileCode2 },
]

const PRESET_OPTIONS = [
  { id: 'five_star', label: '5 星高口碑导师', tag: '5分评价' },
  { id: 'zero_risk', label: '零负面评价导师', tag: '无风险标签' },
  { id: 'internship_no_clock', label: '可实习不打卡导师', tag: '就业友好' },
  { id: 'doctoral', label: '可指导博士导师', tag: '读博/直博' },
  { id: 'library', label: '我的候选库', tag: '含备注进度', icon: Bookmark },
  { id: 'all', label: '全部收录导师汇总', tag: '全量档案' },
]

export default function ExportMenu({
  label = '导出',
  ariaLabel,
  title,
  variant = 'compact',
  align = 'right',
  disabled = false,
  getPayload,
  formats = ['xlsx', 'pdf', 'docx', 'md'],
  showPresets = false,
  presetsOnly = false,
  className = '',
  onSuccess,
  onError,
}) {
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [doneKey, setDoneKey] = useState('')
  const [localError, setLocalError] = useState('')
  const [coords, setCoords] = useState({ alignRight: align === 'right' })
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const timerRef = useRef(null)
  const menuId = useId()

  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => {
    if (!open) return
    function handleOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', handleOutside)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutside)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = menuRef.current.offsetWidth || 280
    const canAlignRight = rect.right >= menuWidth + 12
    const canAlignLeft = window.innerWidth - rect.left >= menuWidth + 12
    let alignRight = align === 'right'
    if (alignRight && !canAlignRight && canAlignLeft) alignRight = false
    else if (!alignRight && !canAlignLeft && canAlignRight) alignRight = true
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < 260 && rect.top > spaceBelow
    setCoords({ alignRight, openUp })
  }, [open, align])

  async function runExport(key, payload) {
    if (busyKey) return
    setBusyKey(key)
    setLocalError('')
    try {
      const result = await exportFile(payload)
      setDoneKey(key)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setDoneKey(''), 1800)
      setOpen(false)
      onSuccess?.(result)
    } catch (err) {
      const msg = err?.message || '导出失败，请重试'
      setLocalError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setBusyKey('')
    }
  }

  const visibleFormats = FORMAT_OPTIONS.filter(f => formats.includes(f.id))
  const isBusy = Boolean(busyKey)
  const triggerClass = [
    'export-menu-trigger',
    `is-${variant}`,
    open ? 'is-open' : '',
    doneKey ? 'is-done' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className="export-menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-label={ariaLabel || label}
        title={title || ariaLabel || label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || isBusy}
        onClick={() => { setLocalError(''); setOpen(v => !v) }}
      >
        {isBusy ? <LoaderCircle size={variant === 'icon' ? 15 : 13} className="spin" aria-hidden="true" /> : doneKey ? <Check size={variant === 'icon' ? 15 : 13} aria-hidden="true" /> : <Download size={variant === 'icon' ? 15 : 13} aria-hidden="true" />}
        {variant !== 'icon' && <span>{isBusy ? '生成中…' : label}</span>}
        {variant !== 'icon' && <ChevronDown size={12} className="export-caret" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="region"
          aria-label={ariaLabel || '选择导出格式'}
          className={`export-menu-popover${coords.alignRight ? ' align-right' : ' align-left'}${coords.openUp ? ' open-up' : ''}`}
        >
          {!presetsOnly && getPayload && (
            <div className="export-menu-group">
              <div className="export-menu-title">导出当前内容为</div>
              {visibleFormats.map(({ id, label: fmtLabel, ext, desc, Icon }) => {
                const key = `main:${id}`
                const itemBusy = busyKey === key
                return (
                  <button
                    key={id}
                    type="button"
                    className="export-menu-item"
                    disabled={isBusy}
                    onClick={() => runExport(key, { ...getPayload(id), format: id })}
                  >
                    <span className="export-item-icon"><Icon size={15} aria-hidden="true" /></span>
                    <span className="export-item-copy">
                      <strong>{fmtLabel} <small>{ext}</small></strong>
                      <span>{itemBusy ? '正在生成文件…' : desc}</span>
                    </span>
                    {itemBusy && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          )}

          {(showPresets || presetsOnly) && (
            <div className="export-menu-group export-presets-group">
              <div className="export-menu-title"><Sparkles size={12} aria-hidden="true" />快捷专题导出</div>
              <div className="export-preset-list">
                {PRESET_OPTIONS.map(preset => (
                  <div className="export-preset-row" key={preset.id}>
                    <div className="export-preset-meta">
                      <strong>{preset.label}</strong>
                      <small>{preset.tag}</small>
                    </div>
                    <div className="export-preset-pills">
                      {['xlsx', 'pdf', 'docx'].map(fmt => {
                        const key = `preset:${preset.id}:${fmt}`
                        const itemBusy = busyKey === key
                        return (
                          <button
                            key={fmt}
                            type="button"
                            className="export-preset-pill"
                            aria-label={`导出${preset.label} ${fmt.toUpperCase()}`}
                            disabled={isBusy}
                            onClick={() => runExport(key, { kind: 'preset', preset: preset.id, format: fmt })}
                          >
                            {itemBusy ? '…' : fmt === 'xlsx' ? 'Excel' : fmt === 'pdf' ? 'PDF' : 'Word'}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localError && <p className="export-menu-error" role="alert">{localError}</p>}
        </div>
      )}
    </div>
  )
}

import React from 'react'

export function MessageListSkeleton() {
  return (
    <div className="message-skeleton" aria-busy="true">
      <span className="sr-only" role="status">正在加载对话…</span>
      <span className="skeleton-box" style={{ width: '58%', height: 18 }} aria-hidden="true" />
      <span className="skeleton-box" style={{ width: '92%', height: 14 }} aria-hidden="true" />
      <span className="skeleton-box" style={{ width: '76%', height: 14 }} aria-hidden="true" />
    </div>
  )
}

export function QuickSearchSkeleton({ rows = 5 }) {
  return (
    <div className="qs-skeleton-list" aria-busy="true">
      <span className="sr-only" role="status">正在加载全校导师档案…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="qs-skeleton-item" key={i} aria-hidden="true">
          <span className="skeleton-box skeleton-avatar" />
          <div className="qs-skeleton-body">
            <div className="qs-skeleton-row">
              <span className="skeleton-box" style={{ width: 64, height: 16 }} />
              <span className="skeleton-box" style={{ width: 42, height: 16, borderRadius: 999 }} />
              <span className="skeleton-box" style={{ width: 132, height: 14 }} />
            </div>
            <div className="qs-skeleton-row">
              <span className="skeleton-box" style={{ width: 72, height: 20, borderRadius: 999 }} />
              <span className="skeleton-box" style={{ width: 64, height: 20, borderRadius: 999 }} />
              <span className="skeleton-box" style={{ width: 84, height: 20, borderRadius: 999 }} />
            </div>
            <span className="skeleton-box" style={{ width: `${72 - (i % 3) * 11}%`, height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function DossierDetailSkeleton() {
  return (
    <section className="dossier-bento-card dossier-skeleton" aria-busy="true">
      <span className="sr-only" role="status">正在加载导师详细信息…</span>
      <span className="skeleton-box" style={{ width: 120, height: 14 }} aria-hidden="true" />
      <div className="dossier-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="dossier-skeleton-card" key={i}>
            <span className="skeleton-box" style={{ width: 68, height: 11 }} />
            <span className="skeleton-box" style={{ width: '92%', height: 13 }} />
            <span className="skeleton-box" style={{ width: '64%', height: 13 }} />
          </div>
        ))}
      </div>
    </section>
  )
}

export function WorkbenchSkeleton({ cards = 3, withSummary = true }) {
  return (
    <div className="workbench-skeleton" aria-busy="true">
      <span className="sr-only" role="status">正在载入工作台…</span>
      {withSummary && (
        <div className="workspace-summary skeleton-summary" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <span className="skeleton-box" style={{ width: 64, height: 11, marginBottom: 8 }} />
              <span className="skeleton-box" style={{ width: 42, height: 26 }} />
            </div>
          ))}
        </div>
      )}
      <div className="mentor-tile-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <div className="mentor-tile mentor-tile-skeleton" key={i}>
            <div className="qs-skeleton-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'grid', gap: 6, flex: 1 }}>
                <span className="skeleton-box" style={{ width: 76, height: 18 }} />
                <span className="skeleton-box" style={{ width: 128, height: 11 }} />
              </div>
              <span className="skeleton-box" style={{ width: 22, height: 22, borderRadius: 6 }} />
            </div>
            <div className="qs-skeleton-row" style={{ marginBottom: 12 }}>
              <span className="skeleton-box" style={{ width: 70, height: 18 }} />
              <span className="skeleton-box" style={{ width: 52, height: 18 }} />
            </div>
            <span className="skeleton-box" style={{ width: '95%', height: 12, marginBottom: 7 }} />
            <span className="skeleton-box" style={{ width: '78%', height: 12, marginBottom: 16 }} />
            <span className="skeleton-box" style={{ width: '100%', height: 12, marginTop: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkbenchDetailSkeleton() {
  return (
    <div className="detail-layout" aria-busy="true">
      <span className="sr-only" role="status">正在读取导师资料…</span>
      <aside className="detail-notes" aria-hidden="true">
        <span className="skeleton-box" style={{ width: 92, height: 13, marginBottom: 16 }} />
        <span className="skeleton-box" style={{ width: 56, height: 11, marginBottom: 8 }} />
        <span className="skeleton-box" style={{ width: '100%', height: 34, marginBottom: 16 }} />
        <span className="skeleton-box" style={{ width: 56, height: 11, marginBottom: 8 }} />
        <span className="skeleton-box" style={{ width: '100%', height: 140 }} />
      </aside>
      <div className="detail-facts" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <section key={i} className="detail-fact-skeleton">
            <span className="skeleton-box" style={{ width: 72, height: 12, marginBottom: 12 }} />
            <span className="skeleton-box" style={{ width: '96%', height: 12, marginBottom: 7 }} />
            <span className="skeleton-box" style={{ width: '82%', height: 12 }} />
          </section>
        ))}
      </div>
    </div>
  )
}

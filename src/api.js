export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body == null || typeof options.body === 'string' ? options.body : JSON.stringify(options.body) })
  const body = await response.json()
  if (!response.ok) { const error = new Error(body.error || `请求失败（${response.status}）`); Object.assign(error,{status:response.status,code:body.code,requiredTier:body.requiredTier}); throw error }
  return body
}

export async function streamChat(id, text, onEvent, { signal } = {}) {
  const response = await fetch(`/api/chats/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal })
  return readEvents(response, onEvent)
}

async function readEvents(response, onEvent) {
  if (!response.ok) { const body = await response.json(); const error = new Error(body.error || '连接失败'); error.status = response.status; throw error }
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', ended = false, reconnect = false
  function event(block) {
    const name = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!name || !data) return
    if (name === 'done' || name === 'error') ended = true
    const payload = JSON.parse(data)
    if (payload.reconnect) reconnect = true
    onEvent(name, payload)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
    }
    buffer += decoder.decode()
    if (buffer.trim()) event(buffer)
    if (!ended) throw new Error('连接中断，已生成的内容会保留。请重新打开对话或再次提问。')
    return { reconnect }
  } finally { reader.releaseLock() }
}

export async function observeChat(id, onEvent, signal) {
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/chats/${id}/events`, { signal })
      const result = await readEvents(response, onEvent)
      if (!result.reconnect) return
    } catch (error) {
      if (signal.aborted) return
      if (error.status >= 400 && error.status < 500) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export function modelLabel(model, {compact=false}={}) {
  const context = model.contextWindow >= 1048576 ? `${Math.round(model.contextWindow / 1048576)}M` : model.contextWindow ? `${Math.round(model.contextWindow / 1024)}K` : ''
  const name=compact?(model.name||model.id).replace(/^(DeepSeek)[-\s]V[\d.]+[-\s]/i,'$1 '):model.name||model.id
  return `${name}${context ? ` · ${context}` : ''}`
}

export const tokenNumber = value => new Intl.NumberFormat('zh-CN').format(value || 0)
export function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const href = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = href; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(href), 1500)
}

function filenameFromHeaders(headers, fallback) {
  const direct = headers.get('x-export-filename')
  if (direct) {
    try { return decodeURIComponent(direct) } catch { return direct }
  }
  const disp = headers.get('content-disposition') || ''
  const utf8Match = disp.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1].trim()) } catch { return utf8Match[1].trim() }
  }
  const plainMatch = disp.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (plainMatch) return plainMatch[1].trim()
  return fallback
}

export async function exportFile(payload) {
  const response = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  if (!response.ok) {
    let body = {}
    try { body = await response.json() } catch {}
    const error = new Error(body.error || `导出失败（${response.status}）`)
    error.status = response.status
    throw error
  }
  const ext = String(payload?.format || 'xlsx').toLowerCase()
  const filename = filenameFromHeaders(response.headers, `北极星导出.${ext}`)
  const blob = await response.blob()
  downloadFile(filename, blob, response.headers.get('content-type') || blob.type)
  return { filename, size: blob.size }
}

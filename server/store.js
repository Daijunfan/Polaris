import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { publicMessages } from '../lib/presentation.js'

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export function defaultSleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function renameWithRetry(from, to, {
  renameSync = fs.renameSync,
  maxRetries = 5,
  baseDelayMs = 10,
  sleepSync = defaultSleepSync,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || attempt >= maxRetries) {
        throw error
      }
      sleepSync(baseDelayMs * (2 ** attempt))
    }
  }
}

// Keep the storage identity stable so product renames preserve saved connections and chats.
export function defaultDataDir() {
  if (process.env.MENTOR_DATA_DIR) return process.env.MENTOR_DATA_DIR
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'MentorLens')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'MentorLens')
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'mentor-lens')
}

export const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, requests: 0, unreportedRequests: 0 })
export function addUsage(total, usage) {
  for (const key of Object.keys(emptyUsage())) total[key] += usage[key] || 0
  return total
}

export function createStore(dir = defaultDataDir(), options = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  function read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8').replace(/^\uFEFF/, '')) }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`无法读取本地 ${name} 数据：${error.message}`) }
  }
  function write(name, value) {
    const target = path.join(dir, `${name}.json`)
    const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
      renameWithRetry(tmp, target, options)
    } catch (error) {
      try { fs.unlinkSync(tmp) } catch {}
      throw error
    }
  }
  const chats = read('chats', []), ledger = read('usage', [])
  const publicChat = chat => ({ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: publicMessages(chat.messages), usage: chat.usage, context: { compactions: chat.context?.compactions || 0, inputTokens: chat.context?.inputTokens || 0, estimatedTokens: chat.context?.estimatedTokens || 0 } })
  return {
    dir, read, write,
    list: ({ deleted = false, query = '' } = {}) => {
      const needle = query.trim().toLocaleLowerCase()
      return chats.filter(c => Boolean(c.deletedAt) === deleted).filter(c => {
        if (!needle || c.title.toLocaleLowerCase().includes(needle)) return true
        return publicMessages(c.messages).some(m => [m.content, ...(m.artifacts || []).flatMap(a => [...a.columns.map(column=>column.label),...a.rows.map(row=>Object.values(row).join(' '))])].join(' ').toLocaleLowerCase().includes(needle))
      }).toSorted((a,b)=>(deleted?b.deletedAt:b.updatedAt).localeCompare(deleted?a.deletedAt:a.updatedAt)).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, deletedAt: c.deletedAt, messageCount: c.messages.length, usage: c.usage }))
    },
    create() {
      const now = new Date().toISOString()
      const chat = { id: randomUUID(), title: '新的选导师对话', createdAt: now, updatedAt: now, messages: [], modelMessages: [], tables: {}, usage: emptyUsage() }
      chats.push(chat); write('chats', chats)
      return publicChat(chat)
    },
    get: id => chats.find(c => c.id === id && !c.deletedAt),
    publicChat,
    save(chat) { chat.updatedAt = new Date().toISOString(); write('chats', chats) },
    remove(id) {
      const chat = chats.find(c => c.id === id && !c.deletedAt)
      if (!chat) return false
      chat.deletedAt = new Date().toISOString(); write('chats', chats); return true
    },
    restore(id) {
      const chat = chats.find(c => c.id === id && c.deletedAt)
      if (!chat) return null
      delete chat.deletedAt; chat.updatedAt = new Date().toISOString(); write('chats', chats)
      return chat
    },
    recordUsage(chat, usage, model, durationMs, purpose = 'inference', details = {}) {
      const entry = { id: randomUUID(), chatId: chat.id, model, purpose, ...details, at: new Date().toISOString(), durationMs, ...usage }
      ledger.push(entry)
      addUsage(chat.usage, usage)
      write('usage', ledger)
      write('chats', chats)
      return entry
    },
    usage: () => ({ ...ledger.reduce((sum, entry) => addUsage(sum, entry), emptyUsage()), recent: ledger.slice(-50).reverse() }),
  }
}

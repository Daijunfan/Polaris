import { cleanDefensiveText } from '../answer-policy.js'
import { fieldLabels } from '../fields.js'
import { fingerprintAxes } from '../insights.js'
import {
  exportText,
  formatDisciplineText,
  internalColumn,
  publicSource,
  publicText,
  publicWebUrl,
  sourceNumber,
} from '../presentation.js'
import {
  columnLabel,
  display,
  formatTableField,
  isMissing,
  isStatusColumn,
  numericColumn,
} from '../../src/presentation.js'

const EXPLICIT_INTERNAL_KEYS = new Set([
  'key',
  'mentor_id',
  'review_id',
  'student_id',
  'exam_id',
  'profile_id',
  'candidate_id',
  'source_locator',
  'source_location',
  'source_ids',
  'sha256',
  'original_sha256',
  'checksum',
  'hash',
  'file_path',
  'tool_name',
])

const NUMERIC_FIELD_KEYS = new Set([
  'rating',
  'stipend_monthly',
  'stipend_monthly_min',
  'stipend_monthly_max',
  'student_count',
  'exam_count',
  'recommended_count',
  'exam_ratio',
  'recommended_ratio',
  'score_first_min',
  'score_first_mean',
  'score_first_median',
  'score_first_max',
  'year',
  'score_first',
  'score_reexam',
  'score_total',
  'politics',
  'foreign_language',
  'subject_one',
  'subject_two',
  'rank_first',
  'rank_first_program',
  'count',
  'mean',
  'median',
  'min',
  'max',
  'sum',
  'p25',
  'p75',
  '推荐序',
  '序号',
  'match_score',
  'score_reputation',
  'score_freedom',
  'score_internship',
  'score_funding',
  'score_guidance',
  'score_research',
])

const FRACTIONAL_KEYS = /^(?:score_reexam|score_total|score_first_mean|score_first_median)$/
const INTERNAL_TOKEN_ID_RE = /(?<![a-z0-9])(?:profile|mentor|student|exam|review|candidate)-[a-f0-9]{12}(?![a-f0-9])/gi
const INTERNAL_FIELD_TOKEN_RE = /(?<![a-z0-9])(?:profile_id|candidate_id|mentor_id|review_id|student_id|exam_id|source_locator|source_location|source_ids|original_sha256|sha256)(?![a-z0-9])/gi
const MONEY_RANGE_RE = /^\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*[-–—~]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*$/
const MONEY_SINGLE_RE = /^\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*$/
const EXPLICIT_INTERNAL_LABEL_RE = /^(?:profile_id|candidate_id|mentor_id|review_id|student_id|exam_id|source_locator|source_location|source_ids|sha256|original_sha256)$/i
const DISCIPLINE_FIELDS = new Set([
  'doctoral_evidence',
  'profile_evidence',
  'admissions',
  'directions',
  'personal_directions',
  'research_areas',
  'direction_summary',
])

export const RADAR_COLORS = ['#1d4b8f', '#d97706', '#0d9488', '#7c3aed']

export function safeString(value, fallback = '') {
  if (value == null) return fallback
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return String(value)
  }
  try {
    return String(value)
  } catch {
    try {
      const keys = Object.keys(value)
      if (!keys.length) return fallback
      const seen = new WeakSet()
      const json = JSON.stringify(value, (_k, v) => {
        if (typeof v === 'bigint' || typeof v === 'symbol') return String(v)
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        return v
      })
      return json && json !== '{}' ? json : fallback
    } catch {
      return fallback
    }
  }
}

export function safeNumber(value, fallback = null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : fallback
  }
  return fallback
}

export function isInternalField(column) {
  if (!column || (typeof column !== 'string' && typeof column !== 'object')) return false
  const key = typeof column === 'string' ? column : safeString(column.key)
  const label = typeof column === 'string' ? '' : safeString(column.label).trim()
  if (key && EXPLICIT_INTERNAL_KEYS.has(key)) return true
  if (label && EXPLICIT_INTERNAL_LABEL_RE.test(label)) return true
  return internalColumn(typeof column === 'string' ? column : { key, label })
}

function stripLoneSurrogates(str) {
  return safeString(str).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

function sliceSafeCodeUnits(str, maxUnits) {
  const s = safeString(str)
  const limit = Math.max(0, maxUnits)
  if (s.length <= limit) return s
  let end = limit
  if (end > 0) {
    const code = s.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1
    }
  }
  return s.slice(0, end)
}

function stripOuterQuotesAndSpaces(str) {
  let cur = safeString(str)
  let prev = ''
  while (cur !== prev) {
    prev = cur
    cur = cur.replace(/^['\s]+|['\s]+$/g, '')
  }
  return cur
}

export function sanitizeFilename(name, fallback = '北极星导出') {
  const cleaned = stripLoneSurrogates(safeString(name))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim()
  return cleaned || fallback
}

function hasSheetNameCaseInsensitive(usedNames, candidate) {
  const lower = candidate.toLowerCase()
  for (const name of usedNames) {
    if (safeString(name).toLowerCase() === lower) return true
  }
  return false
}

function cleanExcelSheetBase(raw) {
  let cleaned = stripLoneSurrogates(safeString(raw))
    .replace(/[\\/*?:[\]\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
  cleaned = stripOuterQuotesAndSpaces(cleaned)
  cleaned = sliceSafeCodeUnits(cleaned, 31)
  cleaned = stripOuterQuotesAndSpaces(cleaned)
  if (!cleaned) cleaned = '数据表'
  if (/^history$/i.test(cleaned)) cleaned = 'History_'
  return cleaned
}

export function sanitizeSheetName(name, usedNames = new Set()) {
  const baseRaw = cleanExcelSheetBase(name)
  let candidate = baseRaw
  if (!hasSheetNameCaseInsensitive(usedNames, candidate)) {
    usedNames.add(candidate)
    return candidate
  }
  let index = 2
  while (index < 1000) {
    const suffix = `_${index}`
    const prefix = stripOuterQuotesAndSpaces(sliceSafeCodeUnits(baseRaw, Math.max(1, 31 - suffix.length))) || '表'
    candidate = `${prefix}${suffix}`
    if (!hasSheetNameCaseInsensitive(usedNames, candidate)) {
      usedNames.add(candidate)
      return candidate
    }
    index += 1
  }
  let n = usedNames.size + 1
  let fallback = sliceSafeCodeUnits(`表_${n}`, 31)
  while (hasSheetNameCaseInsensitive(usedNames, fallback)) {
    n += 1
    fallback = sliceSafeCodeUnits(`表_${n}`, 31)
  }
  usedNames.add(fallback)
  return fallback
}

export function todayShanghai() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

export function stripInternalTokens(text) {
  return safeString(text)
    .replace(INTERNAL_TOKEN_ID_RE, '相关记录')
    .replace(INTERNAL_FIELD_TOKEN_RE, '资料信息')
}

const SOURCE_FILE_LABELS = {
  导师评价: '导师评价',
  初试结果: '初试成绩资料',
  复试结果: '复试结果资料',
}

function sourceFileLabel(name) {
  return typeof name === 'string' && Object.hasOwn(SOURCE_FILE_LABELS, name)
    ? SOURCE_FILE_LABELS[name]
    : '资料来源'
}

const INTERNAL_FENCED_BLOCK_RE = /(?:source_locator|source_location|source_ids|mentor_id|student_id|exam_id|review_id|profile_id|candidate_id|tool_calls|"(?:from|select|filters|parameters|arguments)"\s*:)|(?<![a-z0-9])(?:profile|mentor|student|exam|review|candidate)-[a-f0-9]{12}(?![a-f0-9])/i

function stripInternalFencedBlocks(value) {
  const src = safeString(value)
  if (!src || !src.includes('```')) return src

  const lines = []
  let start = 0
  const len = src.length
  while (start <= len) {
    const nl = src.indexOf('\n', start)
    if (nl < 0) {
      const raw = src.slice(start)
      const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      lines.push({ start, end: len, text })
      break
    }
    const raw = src.slice(start, nl)
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    lines.push({ start, end: nl + 1, text })
    start = nl + 1
    if (start === len) break
  }

  let out = ''
  let changed = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const stdMatch = line.text.match(/^([ \t]*)(`{3,})([^\n]*)$/)
    if (stdMatch && !stdMatch[3].includes('`'.repeat(stdMatch[2].length)) && i + 1 < lines.length) {
      const fenceLen = stdMatch[2].length
      const closeRe = new RegExp(`^[ \\t]*\`{${fenceLen},}[ \\t]*$`)
      let closeIdx = -1
      for (let j = i + 1; j < lines.length; j += 1) {
        if (closeRe.test(lines[j].text)) {
          closeIdx = j
          break
        }
      }
      const endLine = closeIdx >= 0 ? closeIdx : lines.length - 1
      const block = src.slice(line.start, lines[endLine].end)
      if (INTERNAL_FENCED_BLOCK_RE.test(block)) {
        if (closeIdx >= 0) {
          out += src.slice(lines[endLine].start + lines[endLine].text.length, lines[endLine].end)
        }
        changed = true
      } else {
        out += block
      }
      i = endLine + 1
      continue
    }

    const inlineMatch = line.text.match(/^([^\n]*?)(`{3,})([^\n]*)$/)
    if (inlineMatch && inlineMatch[1] && !inlineMatch[3].includes('`'.repeat(inlineMatch[2].length)) && i + 1 < lines.length) {
      const prefix = inlineMatch[1]
      const fenceLen = inlineMatch[2].length
      const closeLineRe = new RegExp(`^[ \\t]*\`{${fenceLen},}(.*)$`)
      let closeIdx = -1
      let suffix = ''
      for (let j = i + 1; j < lines.length; j += 1) {
        const cm = lines[j].text.match(closeLineRe)
        if (cm) {
          closeIdx = j
          suffix = cm[1] || ''
          break
        }
      }
      const endLine = closeIdx >= 0 ? closeIdx : lines.length - 1
      const block = src.slice(line.start + prefix.length, lines[endLine].end)
      if (INTERNAL_FENCED_BLOCK_RE.test(block)) {
        const trailingNl = closeIdx >= 0
          ? src.slice(lines[endLine].start + lines[endLine].text.length, lines[endLine].end)
          : ''
        out += prefix + suffix + trailingNl
        changed = true
      } else {
        out += src.slice(line.start, lines[endLine].end)
      }
      i = endLine + 1
      continue
    }

    out += src.slice(line.start, line.end)
    i += 1
  }

  return changed ? out : src
}

function convergeInternalMarkers(value) {
  let text = value
  while (true) {
    const next = stripInternalFencedBlocks(
      cleanDefensiveText(text)
        .replace(/<[｜|]{1,2}DSML[｜|]{1,2}[\s\S]*$/gi, '')
        .replace(/\{\{\s*chart\s*\}\}/g, ''),
    )
    if (next === text) break
    text = next
  }
  return text
}

function isBlockedLocalHostname(hostname) {
  const host = safeString(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    /^127\./.test(host) ||
    /^0+\.0+\.0+\.0+$/.test(host)
  ) {
    return true
  }
  if (
    /^::ffff:(?:7f[0-9a-f]{2}|0+):[0-9a-f]{1,4}$/.test(host) ||
    /^::ffff:(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0+\.0+\.0+\.0+)$/.test(host)
  ) {
    return true
  }
  return false
}

const LOCALHOST_HOST_PATTERN = '(?:(?:[a-z0-9-]+\\.)*localhost\\.?|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|0\\.0\\.0\\.0|\\[::1\\]|\\[::\\]|\\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|0+:0+|0\\.0\\.0\\.0)\\])'
const LOCALHOST_API_RE = new RegExp(`https?:\\/\\/${LOCALHOST_HOST_PATTERN}(?::\\d+)?\\/api\\/[^\\s\`<>|\\[\\]{}，。；）)]*`, 'gi')
const LOCAL_PATH_RE = /(?<![\w:/])(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|workspace|api)\/)[^\s`<>|\[\]{}，。；）)]*/gi

export function safePublicWebUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const href = publicWebUrl(value)
  if (!href) return null
  try {
    const host = new URL(href).hostname
    if (isBlockedLocalHostname(host)) return null
    return href
  } catch {
    return null
  }
}

function isBlockedMarkdownLinkTarget(src, contentStart, contentEnd, nextNonWs, nextWs) {
  const start = nextNonWs[contentStart]
  if (start >= contentEnd) return false

  const probe = src.slice(start, Math.min(contentEnd, start + 64))
  const collapsedProbe = probe.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  const unwrappedProbe = collapsedProbe.startsWith('<') ? collapsedProbe.slice(1) : collapsedProbe
  if (/^(?:javascript|vbscript|data):/i.test(unwrappedProbe)) {
    return true
  }

  let dest = ''
  if (src[start] === '<') {
    const gt = src.indexOf('>', start + 1)
    if (gt > start && gt < contentEnd) {
      dest = src.slice(start + 1, gt).trim()
    } else {
      dest = src.slice(start + 1, contentEnd).trim()
    }
  } else {
    const ws = Math.min(contentEnd, nextWs[start])
    const len = ws - start
    if (len > 512) {
      const schemeMatch = src.slice(start, start + 8).match(/^https?:\/\//i)
      if (schemeMatch) {
        const authStart = start + schemeMatch[0].length
        const authScanEnd = Math.min(ws, authStart + 512)
        let sep = -1
        for (let k = authStart; k < authScanEnd; k += 1) {
          const c = src[k]
          if (c === '/' || c === '?' || c === '#' || c === '\\') {
            sep = k
            break
          }
        }
        if (sep < 0) return true
        dest = src.slice(start, sep)
      } else {
        dest = src.slice(start, Math.min(ws, start + 512))
      }
    } else {
      dest = src.slice(start, ws)
    }
  }

  const unescaped = dest.replace(/\\([\\()])/g, '$1')
  const collapsedDest = unescaped.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  if (/^(?:javascript|vbscript|data):/i.test(collapsedDest)) {
    return true
  }
  if (/^https?:\/\//i.test(unescaped)) {
    return !safePublicWebUrl(unescaped)
  }
  return false
}

function stripBlockedMarkdownLinks(value) {
  const src = safeString(value)
  if (!src || !src.includes('](')) return src

  const len = src.length
  const closeBracketOf = new Map()
  const bracketStack = []
  const closeParenOf = new Map()
  const parenStack = []

  for (let p = 0; p < len; p += 1) {
    const ch = src[p]
    if (ch === '\\' && p + 1 < len) {
      p += 1
      continue
    }
    if (ch === '[') {
      bracketStack.push(p)
    } else if (ch === ']' && bracketStack.length > 0) {
      closeBracketOf.set(bracketStack.pop(), p)
    } else if (ch === '(') {
      parenStack.push(p)
    } else if (ch === ')' && parenStack.length > 0) {
      closeParenOf.set(parenStack.pop(), p)
    }
  }

  if (closeBracketOf.size === 0 || closeParenOf.size === 0) return src

  const nextNonWs = new Int32Array(len + 1)
  const nextWs = new Int32Array(len + 1)
  let nonWs = len
  let wsPos = len
  nextNonWs[len] = len
  nextWs[len] = len
  for (let p = len - 1; p >= 0; p -= 1) {
    if (/\s/.test(src[p])) wsPos = p
    else nonWs = p
    nextNonWs[p] = nonWs
    nextWs[p] = wsPos
  }

  const keep = new Uint8Array(len)
  keep.fill(1)
  let changed = false

  for (let i = 0; i < len; ) {
    if (!keep[i]) {
      i += 1
      continue
    }
    const ch = src[i]
    if (ch === '\\' && i + 1 < len) {
      i += 2
      continue
    }
    if (ch === '[') {
      const closeBracket = closeBracketOf.get(i)
      if (closeBracket !== undefined && src[closeBracket + 1] === '(') {
        const closeParen = closeParenOf.get(closeBracket + 1)
        if (closeParen !== undefined && nextNonWs[closeBracket + 2] < closeParen) {
          if (isBlockedMarkdownLinkTarget(src, closeBracket + 2, closeParen, nextNonWs, nextWs)) {
            keep[i] = 0
            keep.fill(0, closeBracket, closeParen + 1)
            changed = true
          }
        }
      }
    }
    i += 1
  }

  if (!changed) return src

  let out = ''
  let chunkStart = -1
  for (let i = 0; i < len; i += 1) {
    if (keep[i]) {
      if (chunkStart < 0) chunkStart = i
    } else if (chunkStart >= 0) {
      out += src.slice(chunkStart, i)
      chunkStart = -1
    }
  }
  if (chunkStart >= 0) out += src.slice(chunkStart)
  return out
}

export function preGuardPublicText(value) {
  if (typeof value !== 'string') return value
  const text = stripBlockedMarkdownLinks(convergeInternalMarkers(value))
    .replace(LOCALHOST_API_RE, '内部查询')
    .replace(LOCAL_PATH_RE, '内部资料')
  return text
    .replace(
      /(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:md|markdown|pdf|xlsx?|csv|jsonl?|tsx?|jsx?)(?:[:#](?:(?:L|P|page=)?\d*)?(?:-(?:L|P)?\d*)?)?/gi,
      (match, name, offset, input) => {
        if (/https?:\/\/\S*$/.test(input.slice(0, offset))) return match
        if (!(name in SOURCE_FILE_LABELS) || Object.hasOwn(SOURCE_FILE_LABELS, name)) return match
        return '资料来源'
      },
    )
    .replace(/\bcolor_by\s*[:=]\s*["']?([a-z_]+)["']?/g, (match, field) => (
      field in fieldLabels && !Object.hasOwn(fieldLabels, field)
        ? '按业务分类分色'
        : match
    ))
}

export function sanitizeExportFilename(name, fallback = '北极星导出') {
  let text = convergeInternalMarkers(safeString(name))
    .replace(LOCALHOST_API_RE, '内部查询')
  const trimmed = text.trim()
  const standaloneBasename = trimmed.match(
    /^(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|workspace|api)\/)[^\n]*[\\/]([^\\/\s`<>|\[\]{}，。；）)]+\.(?:xlsx?|pdf|docx|md|markdown|csv))$/i,
  )
  if (standaloneBasename) {
    text = standaloneBasename[1]
  }
  const stripped = stripInternalTokens(preGuardPublicText(text))
    .replace(/(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:jsonl?|tsx?|jsx?)(?:[:#](?:(?:L|P|page=)?\d*)?(?:-(?:L|P)?\d*)?)?/gi, '资料来源')
    .replace(/(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:md|markdown|pdf|xlsx?|csv)[:#](?:(?:L|P|page=)?\d+)(?:-(?:L|P)?\d*)?/gi, (_, n) => sourceFileLabel(n))
    .replace(/(?:[\w.-]+[/\\])*(导师评价|初试结果|复试结果)(?:\.(?:md|markdown|pdf|xlsx?|csv))?(?![^\s`<>|/\\\[\]{}（）()，。；：:"'])/gi, (_, n) => sourceFileLabel(n))
    .replace(/原文位置|原文定位|文件路径/g, '资料来源')
  return sanitizeFilename(stripInternalTokens(stripped), fallback)
}

export function sanitizeTitleText(value) {
  if (value == null) return ''
  let text = stripInternalTokens(preGuardPublicText(safeString(value)))
  text = text
    .replace(/(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:jsonl?|tsx?|jsx?)(?:[:#](?:(?:L|P|page=)?\d*)?(?:-(?:L|P)?\d*)?)?/gi, (match, _name, offset, input) => (
      /https?:\/\/\S*$/.test(input.slice(0, offset)) ? match : '资料来源'
    ))
    .replace(/(?:[\w.-]+[/\\])*([^\s`<>|/\\\[\]{}（）()，。；：:"']+)\.(?:md|markdown|pdf|xlsx?|csv)[:#](?:(?:L|P|page=)?\d+)(?:-(?:L|P)?\d*)?/gi, (match, name, offset, input) => (
      /https?:\/\/\S*$/.test(input.slice(0, offset))
        ? match
        : sourceFileLabel(name)
    ))
    .replace(/(?:[\w.-]+[/\\])*(导师评价|初试结果|复试结果)(?:\.(?:md|markdown|pdf|xlsx?|csv))?(?![^\s`<>|/\\\[\]{}（）()，。；：:"'])/gi, (match, name, offset, input) => (
      /https?:\/\/\S*$/.test(input.slice(0, offset))
        ? match
        : sourceFileLabel(name)
    ))
    .replace(/原文位置|原文定位|文件路径/g, '资料来源')
    .replace(/\[S(\d+)\]/g, '[$1]')
  return stripInternalTokens(text)
}

export function sanitizeText(value, options) {
  if (value == null) return ''
  const preCleaned = stripInternalTokens(preGuardPublicText(safeString(value)))
  const exported = exportText(preCleaned, options)
  if (exported == null || exported === '') return ''
  return stripInternalTokens(exported)
}

export const cleanText = sanitizeText

export function dedupeSources(sources = []) {
  if (!Array.isArray(sources)) return []
  const map = new Map()
  const guardSourceText = v => (typeof v === 'string' ? preGuardPublicText(v) : (v != null ? preGuardPublicText(safeString(v)) : v))
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    const guardedSource = {
      ...source,
      ...(source.id !== undefined ? { id: safeString(source.id) } : {}),
      ...(source.url !== undefined ? { url: typeof source.url === 'string' ? (safePublicWebUrl(source.url) || '') : undefined } : {}),
      ...(source.title !== undefined ? { title: guardSourceText(source.title) } : {}),
      ...(source.kind !== undefined ? { kind: guardSourceText(source.kind) } : {}),
      ...(source.scope !== undefined ? { scope: guardSourceText(source.scope) } : {}),
      ...(source.publisher !== undefined ? { publisher: guardSourceText(source.publisher) } : {}),
    }
    const pub = publicSource(guardedSource)
    if (!pub || typeof pub !== 'object') continue
    const cleaned = {
      ...pub,
      ...(pub.id != null ? { id: stripInternalTokens(safeString(pub.id)) } : {}),
      title: sanitizeText(pub.title),
      kind: sanitizeText(pub.kind),
      scope: pub.scope ? sanitizeText(pub.scope) : pub.scope,
      ...(pub.publisher ? { publisher: sanitizeText(pub.publisher) } : {}),
      ...(pub.year !== undefined ? { year: safeNumber(pub.year) ?? (safeString(pub.year) || undefined) } : {}),
      ...(pub.published_at !== undefined ? { published_at: safeString(pub.published_at) || undefined } : {}),
      ...(pub.fetched_at !== undefined ? { fetched_at: safeString(pub.fetched_at) || undefined } : {}),
    }
    const key = cleaned.id || cleaned.url || cleaned.title
    if (!key || map.has(key)) continue
    map.set(key, cleaned)
  }
  return [...map.values()]
}

function sanitizeCellValue(value, key, mentorTitle = '', seen = new WeakSet()) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (seen.has(value)) return null
    seen.add(value)
    try {
      return value
        .map(item => sanitizeCellValue(item, key, mentorTitle, seen))
        .filter(item => item != null && item !== '')
    } finally {
      seen.delete(value)
    }
  }
  const clean = sanitizeText(safeString(value))
  if (!clean) return null
  const formatted = formatTableField(key, clean, mentorTitle)
  return formatted == null ? null : formatted
}

const ADMISSION_LABELS = { exam: '考研', recommended: '保研' }
const STATUS_LABELS = {
  unique: '可确认归属',
  ambiguous: '归属待确认',
  unmatched: '暂无对应资料',
  unlinked: '暂无成绩记录',
  not_admitted: '未拟录取',
}

function safeColumnForDisplay(col) {
  return {
    key: typeof col?.key === 'string' ? col.key : safeString(col?.key),
    label: typeof col?.label === 'string' ? col.label : safeString(col?.label),
  }
}

function safeStringifyValue(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return ''
    seen.add(value)
    try {
      return value.map(item => sanitizeText(safeStringifyValue(item, seen))).filter(Boolean).join('、') || '—'
    } finally {
      seen.delete(value)
    }
  }
  return safeString(value)
}

export function formatCell(value, column = {}, seen = new WeakSet()) {
  const col = column && typeof column === 'object' && !Array.isArray(column) ? column : {}
  if (isMissing(value)) return '—'
  const colDesc = safeColumnForDisplay(col)
  const colType = safeString(col.type)
  const colFrac = safeNumber(col.fractionDigits)
  const safeCol = {
    ...colDesc,
    ...(colType ? { type: colType } : {}),
    ...(colFrac != null ? { fractionDigits: colFrac } : {}),
  }
  const isAdmissionCol = /(?:^|_)admission_type$/.test(colDesc.key)
  const isStatusCol = isStatusColumn(colDesc)
  if (typeof value === 'string') {
    const clean = sanitizeText(value)
    if (isMissing(clean)) return '—'
    if (DISCIPLINE_FIELDS.has(colDesc.key)) {
      return formatDisciplineText(clean) || '—'
    }
    if (isAdmissionCol) {
      return Object.hasOwn(ADMISSION_LABELS, clean) ? ADMISSION_LABELS[clean] : clean
    }
    if (colType === 'money') {
      const rangeMatch = clean.match(MONEY_RANGE_RE)
      if (rangeMatch) {
        const fmt = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(String(n).replaceAll(',', '')))
        return `${fmt(rangeMatch[1])}–${fmt(rangeMatch[2])}`
      }
      const singleMatch = clean.match(MONEY_SINGLE_RE)
      if (singleMatch) {
        return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(String(singleMatch[1]).replaceAll(',', '')))
      }
      return clean
    }
    if (isStatusCol) {
      return Object.hasOwn(STATUS_LABELS, clean) ? STATUS_LABELS[clean] : clean
    }
    return display(clean, safeCol)
  }
  if (isAdmissionCol || isStatusCol) {
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (typeof value === 'number') return display(value, safeCol)
    const text = safeStringifyValue(value)
    const clean = Array.isArray(value) ? text : sanitizeText(text)
    if (isMissing(clean)) return '—'
    if (isAdmissionCol) {
      return Object.hasOwn(ADMISSION_LABELS, clean) ? ADMISSION_LABELS[clean] : clean
    }
    return Object.hasOwn(STATUS_LABELS, clean) ? STATUS_LABELS[clean] : clean
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return display(value, safeCol)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '—'
    seen.add(value)
    try {
      const joined = value.map(item => formatCell(item, safeCol, seen)).filter(v => v && v !== '—').join('、')
      return joined || '—'
    } finally {
      seen.delete(value)
    }
  }
  const str = safeString(value)
  if (isMissing(str)) return '—'
  const clean = sanitizeText(str)
  if (isMissing(clean)) return '—'
  return formatCell(clean, safeCol, seen)
}

export function normalizeTable(table = {}, options = {}) {
  const tbl = table && typeof table === 'object' && !Array.isArray(table) ? table : {}
  const usedSheetNames = options?.usedSheetNames instanceof Set ? options.usedSheetNames : new Set()
  const rawColumns = Array.isArray(tbl.columns) ? tbl.columns : []
  const columns = rawColumns
    .filter(col => col && typeof col === 'object' && !Array.isArray(col) && typeof col.key === 'string' && col.key && !isInternalField(col))
    .map(col => {
      const ownFieldLabel = Object.hasOwn(fieldLabels, col.key) ? fieldLabels[col.key] : undefined
      const safeLabel = (typeof col.label === 'string' ? col.label : '') || ownFieldLabel || col.key
      const safeType = (typeof col.type === 'string' ? col.type : '') || 'unknown'
      const safeRole = typeof col.role === 'string' ? col.role : ''
      const safeFrac = safeNumber(col.fractionDigits)
      return {
        key: col.key,
        label: sanitizeText(columnLabel({ key: col.key, label: safeLabel, type: safeType })),
        type: safeType,
        ...(safeRole ? { role: safeRole } : {}),
        ...(safeFrac != null ? { fractionDigits: safeFrac } : {}),
      }
    })

  const rawRows = Array.isArray(tbl.rows)
    ? tbl.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row))
    : []
  const rows = rawRows.map(row => {
    const title = safeString(row?.professional_title) || safeString(row?.title)
    const out = {}
    for (const col of columns) {
      const rawVal = row && Object.hasOwn(row, col.key) ? row[col.key] : null
      Object.defineProperty(out, col.key, {
        value: sanitizeCellValue(rawVal, col.key, title),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return out
  })

  const enrichedColumns = columns.map(col => {
    const isNumeric = col.type === 'money' || col.type === 'number' || NUMERIC_FIELD_KEYS.has(col.key) || numericColumn(col, rows)
    const vals = rows
      .map(r => (Object.hasOwn(r, col.key) ? r[col.key] : undefined))
      .filter(v => typeof v === 'number' && Number.isFinite(v))
    const hasFraction = vals.some(v => !Number.isInteger(v))
    const fractionDigits = col.fractionDigits ?? (FRACTIONAL_KEYS.test(col.key) ? 2 : hasFraction ? 2 : 0)
    return {
      ...col,
      numeric: isNumeric,
      fractionDigits,
    }
  })

  const title = sanitizeTitleText(safeString(tbl.title) || safeString(tbl.sheetName) || '数据明细')
  const rawSheet = sanitizeTitleText(safeString(tbl.sheetName) || title || '数据表')
  const sheetName = sanitizeSheetName(rawSheet, usedSheetNames)
  return {
    sheetName,
    title,
    description: sanitizeText(safeString(tbl.description)),
    columns: enrichedColumns,
    rows,
  }
}

function escapeXml(value) {
  return safeString(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

/**
 * Generates an inline standalone SVG radar chart matching src/components/MentorInsight.jsx geometry.
 */
export function radarSvg(series = [], options = {}) {
  const cleanSeries = Array.isArray(series)
    ? series.filter(item => item && typeof item === 'object' && !Array.isArray(item))
    : []
  if (!cleanSeries.length) return ''
  const safeOpts = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const showLabels = safeOpts.showLabels !== undefined ? Boolean(safeOpts.showLabels) : true
  const minSize = showLabels ? 120 : 40
  const size = Number.isFinite(safeOpts.size) && safeOpts.size > 0 ? Math.max(minSize, safeOpts.size) : 240
  const center = size / 2
  const radius = size / 2 - (showLabels ? 46 : 10)
  const count = fingerprintAxes.length
  const point = (index, value) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count
    const d = (radius * value) / 5
    return [Number((center + d * Math.cos(angle)).toFixed(2)), Number((center + d * Math.sin(angle)).toFixed(2))]
  }

  const axisScore = (item, key) => {
    const raw = item.fingerprint?.[key]?.value
    if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, Math.min(5, raw)) : null
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return null
      const num = Number(trimmed)
      return Number.isFinite(num) ? Math.max(0, Math.min(5, num)) : null
    }
    return null
  }

  const ariaLabel = '培养画像：' + cleanSeries
    .map(item => {
      const itemName = safeString(item.name)
      return (itemName ? `${sanitizeText(itemName)} ` : '') + fingerprintAxes.map(axis => `${safeString(axis.label)}${axisScore(item, axis.key) ?? '无记录'}`).join('，')
    })
    .join('；')

  const rings = [1, 2, 3, 4, 5].map(level => {
    const pts = fingerprintAxes.map((_, idx) => point(idx, level).join(',')).join(' ')
    const dash = level === 5 ? ' stroke-dasharray="3 3"' : ''
    const stroke = level === 5 ? '#cbd5e1' : '#e2e8f0'
    return `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-width="1"${dash}/>`
  }).join('')

  const axes = fingerprintAxes.map((axis, idx) => {
    const [x, y] = point(idx, 5)
    const [lx, ly] = point(idx, 6.08)
    const anchor = Math.abs(lx - center) < 4 ? 'middle' : lx > center ? 'start' : 'end'
    const empty = cleanSeries.every(item => axisScore(item, axis.key) == null)
    const labelColor = empty ? '#64748b' : '#334155'
    const labelEl = showLabels
      ? `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="11.5" font-weight="600" fill="${labelColor}">${escapeXml(safeString(axis.label))}</text>`
      : ''
    return `<g><line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>${labelEl}</g>`
  }).join('')

  const polygons = cleanSeries.map((item, seriesIndex) => {
    const color = escapeXml(safeString(item.color) || RADAR_COLORS[seriesIndex % RADAR_COLORS.length])
    const values = fingerprintAxes.map(axis => axisScore(item, axis.key) ?? 0)
    const pts = values.map((v, idx) => point(idx, Math.max(v, 0.15)).join(',')).join(' ')
    const fillOpacity = cleanSeries.length > 1 ? '0.12' : '0.18'
    const dots = values.map((v, idx) => {
      if (!v) return ''
      const [cx, cy] = point(idx, v)
      return `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#ffffff" stroke="${color}" stroke-width="2"/>`
    }).join('')
    return `<g><polygon points="${pts}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}</g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeXml(ariaLabel)}">${rings}${axes}${polygons}</svg>`
}

const SVG_ALLOWED_TAGS = new Map([
  ['svg', 'svg'],
  ['g', 'g'],
  ['defs', 'defs'],
  ['title', 'title'],
  ['desc', 'desc'],
  ['path', 'path'],
  ['circle', 'circle'],
  ['ellipse', 'ellipse'],
  ['rect', 'rect'],
  ['polygon', 'polygon'],
  ['polyline', 'polyline'],
  ['line', 'line'],
  ['text', 'text'],
  ['tspan', 'tspan'],
  ['lineargradient', 'linearGradient'],
  ['radialgradient', 'radialGradient'],
  ['stop', 'stop'],
  ['clippath', 'clipPath'],
  ['pattern', 'pattern'],
  ['mask', 'mask'],
])

const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'title', 'desc'])
const SVG_RAW_DROP_TAGS = new Set(['script', 'style', 'textarea'])
const SVG_UNWRAP_TAGS = new Set(['a'])

const SVG_ALLOWED_ATTRS = new Map([
  ['xmlns', 'xmlns'],
  ['id', 'id'],
  ['class', 'class'],
  ['role', 'role'],
  ['aria-label', 'aria-label'],
  ['aria-hidden', 'aria-hidden'],
  ['viewbox', 'viewBox'],
  ['width', 'width'],
  ['height', 'height'],
  ['preserveaspectratio', 'preserveAspectRatio'],
  ['style', 'style'],
  ['opacity', 'opacity'],
  ['transform', 'transform'],
  ['d', 'd'],
  ['x', 'x'],
  ['y', 'y'],
  ['x1', 'x1'],
  ['y1', 'y1'],
  ['x2', 'x2'],
  ['y2', 'y2'],
  ['cx', 'cx'],
  ['cy', 'cy'],
  ['r', 'r'],
  ['rx', 'rx'],
  ['ry', 'ry'],
  ['points', 'points'],
  ['dx', 'dx'],
  ['dy', 'dy'],
  ['rotate', 'rotate'],
  ['textlength', 'textLength'],
  ['fill', 'fill'],
  ['fill-opacity', 'fill-opacity'],
  ['fill-rule', 'fill-rule'],
  ['stroke', 'stroke'],
  ['stroke-width', 'stroke-width'],
  ['stroke-opacity', 'stroke-opacity'],
  ['stroke-dasharray', 'stroke-dasharray'],
  ['stroke-dashoffset', 'stroke-dashoffset'],
  ['stroke-linecap', 'stroke-linecap'],
  ['stroke-linejoin', 'stroke-linejoin'],
  ['stroke-miterlimit', 'stroke-miterlimit'],
  ['clip-path', 'clip-path'],
  ['clip-rule', 'clip-rule'],
  ['mask', 'mask'],
  ['text-anchor', 'text-anchor'],
  ['dominant-baseline', 'dominant-baseline'],
  ['alignment-baseline', 'alignment-baseline'],
  ['font-family', 'font-family'],
  ['font-size', 'font-size'],
  ['font-weight', 'font-weight'],
  ['font-style', 'font-style'],
  ['letter-spacing', 'letter-spacing'],
  ['word-spacing', 'word-spacing'],
  ['offset', 'offset'],
  ['stop-color', 'stop-color'],
  ['stop-opacity', 'stop-opacity'],
  ['gradientunits', 'gradientUnits'],
  ['gradienttransform', 'gradientTransform'],
  ['spreadmethod', 'spreadMethod'],
  ['fx', 'fx'],
  ['fy', 'fy'],
  ['patternunits', 'patternUnits'],
  ['patterncontentunits', 'patternContentUnits'],
  ['patterntransform', 'patternTransform'],
  ['clippathunits', 'clipPathUnits'],
  ['maskunits', 'maskUnits'],
  ['maskcontentunits', 'maskContentUnits'],
])

const SAFE_CSS_PROPS = new Set([
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'min-height',
  'display',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'opacity',
  'fill',
  'stroke',
  'stroke-width',
  'font-family',
  'font-size',
  'font-weight',
  'color',
  'background',
  'background-color',
])

const SVG_NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  nbsp: ' ',
  sol: '/',
  lpar: '(',
  rpar: ')',
  semi: ';',
  equals: '=',
}

function decodeHtmlEntities(str) {
  let out = safeString(str)
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
        const code = Number.parseInt(hex, 16)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      })
      .replace(/&#(\d+);?/g, (_, dec) => {
        const code = Number.parseInt(dec, 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      })
      .replace(/&([a-z]+);/gi, (m, name) => {
        const lower = name.toLowerCase()
        return Object.hasOwn(SVG_NAMED_ENTITIES, lower) ? SVG_NAMED_ENTITIES[lower] : m
      })
    if (next === out) break
    out = next
  }
  return out
}

function sanitizeSvgStyle(decoded) {
  if (/[\u0000-\u001f\u007f\\]|\/\*|\*\/|@|url\s*\(|expression\s*\(|var\s*\(|(?:javascript|vbscript|data)\s*:/i.test(decoded)) {
    return null
  }
  const safeDecls = []
  for (const decl of decoded.split(';')) {
    const trimmed = decl.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) return null
    const prop = trimmed.slice(0, colon).trim().toLowerCase()
    const val = trimmed.slice(colon + 1).trim()
    if (!SAFE_CSS_PROPS.has(prop) || !val) continue
    if (!/^[a-zA-Z0-9#%.,()_\s-]+$/.test(val)) continue
    if (/(?:url|expression|var)\s*\(/i.test(val) || /(?:javascript|vbscript|data)\s*:/i.test(val)) continue
    safeDecls.push(`${prop}:${val}`)
  }
  return safeDecls.length ? safeDecls.join(';') : null
}

function sanitizeSvgAttrValue(canonAttr, rawValue) {
  const decoded = decodeHtmlEntities(rawValue)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded)) return null
  const collapsed = decoded.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  if (/(?:javascript|vbscript):|data:|expression\(/i.test(collapsed)) return null

  if (canonAttr === 'xmlns') {
    return decoded.trim() === 'http://www.w3.org/2000/svg' ? 'http://www.w3.org/2000/svg' : null
  }
  if (canonAttr === 'id') {
    const v = decoded.trim()
    return /^[a-zA-Z_][a-zA-Z0-9_:-]*$/.test(v) ? v : null
  }
  if (canonAttr === 'class') {
    const v = decoded.trim()
    return /^[a-zA-Z_][a-zA-Z0-9_\s-]*$/.test(v) ? v : null
  }
  if (canonAttr === 'style') {
    return sanitizeSvgStyle(decoded)
  }
  if (canonAttr === 'fill' || canonAttr === 'stroke' || canonAttr === 'clip-path' || canonAttr === 'mask') {
    if (/url\s*\(/i.test(decoded)) {
      const v = decoded.trim()
      return /^url\(\s*#[a-zA-Z_][a-zA-Z0-9_:-]*\s*\)$/i.test(v) ? v : null
    }
    return decoded
  }
  if (/url\s*\(/i.test(decoded)) return null
  return decoded
}

function sanitizeSvgAttrList(rawAttrs) {
  const clean = []
  const seen = new Set()
  for (const { name, value } of rawAttrs) {
    const lower = name.toLowerCase()
    if (lower.startsWith('on') || lower === 'href' || lower === 'xlink:href') continue
    const canon = SVG_ALLOWED_ATTRS.get(lower)
    if (!canon || seen.has(canon)) continue
    const safeVal = sanitizeSvgAttrValue(canon, value)
    if (safeVal === null) continue
    seen.add(canon)
    clean.push([canon, safeVal])
  }
  return clean
}

function isAsciiWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

function isTagNameStart(ch) {
  const code = ch.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isTagNameChar(ch) {
  const code = ch.charCodeAt(0)
  return isTagNameStart(ch) || (code >= 48 && code <= 57) || ch === ':' || ch === '_' || ch === '-'
}

function findRawCloseTag(lowerInput, start, tagName) {
  const len = lowerInput.length
  const closeTarget = `</${tagName}`
  let scan = start
  while (scan < len) {
    const hit = lowerInput.indexOf(closeTarget, scan)
    if (hit < 0) return null
    let after = hit + closeTarget.length
    while (after < len && isAsciiWs(lowerInput[after])) after += 1
    if (after < len && lowerInput[after] === '>') {
      return { start: hit, end: after + 1 }
    }
    scan = hit + closeTarget.length
  }
  return null
}

function serializeSvgAst(node) {
  const attrStr = node.attrs.length
    ? ` ${node.attrs.map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')}`
    : ''
  if (node.selfClosing && node.children.length === 0) {
    return `<${node.canonTag}${attrStr}/>`
  }
  const inner = node.children.map(child => (
    child.type === 'text' ? escapeXml(child.value) : serializeSvgAst(child)
  )).join('')
  return `<${node.canonTag}${attrStr}>${inner}</${node.canonTag}>`
}

export function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return null
  const input = svg.trim()
  if (!input) return null

  const len = input.length
  const lowerInput = input.toLowerCase()
  const stack = []
  let root = null
  let rootClosed = false
  let i = 0

  const nearestEffectiveParent = () => {
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      if (!stack[k].isUnwrap) return stack[k]
    }
    return null
  }

  while (i < len) {
    if (input[i] !== '<') {
      const start = i
      while (i < len && input[i] !== '<') i += 1
      const text = input.slice(start, i)
      if (!root || rootClosed) {
        if (text.trim()) return null
        continue
      }
      const parent = nearestEffectiveParent()
      if (parent && !parent.drop && SVG_TEXT_TAGS.has(parent.canonTag)) {
        parent.children.push({ type: 'text', value: decodeHtmlEntities(text) })
      }
      continue
    }

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end < 0) return null
      i = end + 3
      continue
    }

    if (input.startsWith('<?', i)) {
      if (!root && /^<\?xml(?:\s|\?>)/i.test(input.slice(i))) {
        const end = input.indexOf('?>', i + 2)
        if (end < 0) return null
        i = end + 2
        continue
      }
      return null
    }

    if (input.startsWith('<!', i)) {
      return null
    }

    const isClosing = i + 1 < len && input[i + 1] === '/'
    let j = i + (isClosing ? 2 : 1)
    if (j >= len || !isTagNameStart(input[j])) {
      if (!root || rootClosed) return null
      const parent = nearestEffectiveParent()
      if (parent && !parent.drop && SVG_TEXT_TAGS.has(parent.canonTag)) {
        parent.children.push({ type: 'text', value: '<' })
      }
      i += 1
      continue
    }

    const nameStart = j
    while (j < len && isTagNameChar(input[j])) j += 1
    const lowerTag = input.slice(nameStart, j).toLowerCase()

    if (isClosing) {
      while (j < len && isAsciiWs(input[j])) j += 1
      if (j < len && input[j] === '<') {
        i = j
        continue
      }
      if (j >= len || input[j] !== '>') return null
      i = j + 1

      if (!root || rootClosed || stack.length === 0) return null
      let matchIdx = -1
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].lowerTag === lowerTag) {
          matchIdx = k
          break
        }
      }
      if (matchIdx < 0) {
        continue
      }
      stack.length = matchIdx
      if (matchIdx === 0) {
        rootClosed = true
      }
      continue
    }

    const attrs = []
    let selfClosing = false
    let abortedAtLt = false

    while (j < len) {
      while (j < len && isAsciiWs(input[j])) j += 1
      if (j >= len) return null
      const ch = input[j]
      if (ch === '<') {
        abortedAtLt = true
        break
      }
      if (ch === '>') {
        j += 1
        break
      }
      if (ch === '/') {
        if (j + 1 < len && input[j + 1] === '>') {
          selfClosing = true
          j += 2
          break
        }
        j += 1
        continue
      }
      if (ch === '=' || ch === '"' || ch === "'") {
        j += 1
        continue
      }

      const attrStart = j
      while (j < len && !isAsciiWs(input[j]) && input[j] !== '=' && input[j] !== '>' && input[j] !== '<' && input[j] !== '"' && input[j] !== "'") {
        if (input[j] === '/' && j + 1 < len && input[j + 1] === '>') break
        if (input[j] === '/' && j > attrStart) break
        j += 1
      }
      const attrName = input.slice(attrStart, j)
      if (!attrName) {
        j += 1
        continue
      }

      while (j < len && isAsciiWs(input[j])) j += 1
      let attrVal = ''
      if (j < len && input[j] === '=') {
        j += 1
        while (j < len && isAsciiWs(input[j])) j += 1
        if (j >= len) return null
        if (input[j] === '"' || input[j] === "'") {
          const quote = input[j]
          j += 1
          const valStart = j
          while (j < len && input[j] !== quote) j += 1
          if (j >= len) return null
          attrVal = input.slice(valStart, j)
          j += 1
        } else {
          const valStart = j
          while (j < len && !isAsciiWs(input[j]) && input[j] !== '>' && input[j] !== '<') {
            if (input[j] === '/' && j + 1 < len && input[j + 1] === '>') break
            j += 1
          }
          attrVal = input.slice(valStart, j)
        }
      }
      attrs.push({ name: attrName, value: attrVal })
    }

    if (abortedAtLt) {
      i = j
      continue
    }

    i = j
    if (rootClosed) return null

    if (!root) {
      if (lowerTag !== 'svg') return null
      root = {
        type: 'element',
        canonTag: 'svg',
        lowerTag: 'svg',
        attrs: sanitizeSvgAttrList(attrs),
        children: [],
        selfClosing,
        drop: false,
        isUnwrap: false,
      }
      if (selfClosing) {
        rootClosed = true
      } else {
        stack.push(root)
      }
      continue
    }

    const parent = stack[stack.length - 1]
    if (!parent) return null

    if (!selfClosing && SVG_RAW_DROP_TAGS.has(lowerTag)) {
      const rawClose = findRawCloseTag(lowerInput, i, lowerTag)
      if (!rawClose) return null
      i = rawClose.end
      continue
    }

    if (parent.drop) {
      if (!selfClosing) {
        stack.push({ lowerTag, drop: true, isUnwrap: false, children: [] })
      }
      continue
    }

    if (SVG_UNWRAP_TAGS.has(lowerTag)) {
      if (!selfClosing) {
        stack.push({ lowerTag, drop: false, isUnwrap: true })
      }
      continue
    }

    const canonTag = SVG_ALLOWED_TAGS.get(lowerTag)
    if (!canonTag) {
      if (!selfClosing) {
        stack.push({ lowerTag, drop: true, isUnwrap: false, children: [] })
      }
      continue
    }

    const node = {
      type: 'element',
      canonTag,
      lowerTag,
      attrs: sanitizeSvgAttrList(attrs),
      children: [],
      selfClosing,
      drop: false,
      isUnwrap: false,
    }
    const targetParent = nearestEffectiveParent()
    if (!targetParent || targetParent.drop) return null
    targetParent.children.push(node)
    if (!selfClosing) {
      stack.push(node)
    }
  }

  if (!root || !rootClosed || stack.length !== 0) return null
  return serializeSvgAst(root)
}

function normalizeSection(section = {}, usedSheetNames, normalizedTables) {
  const sec = section && typeof section === 'object' && !Array.isArray(section) ? section : {}
  const isPlainObj = v => Boolean(v && typeof v === 'object' && !Array.isArray(v))
  const rawSecTables = [
    ...new Set([
      ...(Array.isArray(sec.tables) ? sec.tables.filter(isPlainObj) : []),
      ...(isPlainObj(sec.table) ? [sec.table] : []),
    ]),
  ]
  const seenNorm = new Set()
  const secTables = []
  for (const tbl of rawSecTables) {
    if (!Array.isArray(tbl.columns) || tbl.columns.length === 0) continue
    let norm
    if (normalizedTables.has(tbl)) {
      norm = normalizedTables.get(tbl)
    } else {
      norm = normalizeTable(tbl, { usedSheetNames })
      normalizedTables.set(tbl, norm)
    }
    if (!norm.columns.length) continue
    if (!seenNorm.has(norm)) {
      seenNorm.add(norm)
      secTables.push(norm)
    }
  }

  return {
    heading: sanitizeText(safeString(sec.heading)),
    level: sec.level === 3 ? 3 : 2,
    paragraphs: (Array.isArray(sec.paragraphs) ? sec.paragraphs : []).map(p => sanitizeText(p)).filter(Boolean),
    bullets: (Array.isArray(sec.bullets) ? sec.bullets : []).map(b => sanitizeText(b)).filter(Boolean),
    kvPairs: (Array.isArray(sec.kvPairs) ? sec.kvPairs : [])
      .filter(pair => isPlainObj(pair) && pair.label != null && pair.label !== '')
      .map(pair => ({
        label: sanitizeText(pair.label),
        value: pair.value == null || pair.value === '' ? '—' : sanitizeText(pair.value),
      }))
      .filter(pair => pair.label),
    badges: (Array.isArray(sec.badges) ? sec.badges : [])
      .filter(b => isPlainObj(b) && b.label != null && b.label !== '')
      .map(b => ({
        label: sanitizeText(b.label),
        tone: ['good', 'bad', 'note'].includes(b.tone) ? b.tone : 'note',
        detail: b.detail ? sanitizeText(b.detail) : '',
      }))
      .filter(b => b.label),
    radarSvg: typeof sec.radarSvg === 'string' ? sanitizeSvg(sec.radarSvg) : null,
    quote: sec.quote ? sanitizeText(sec.quote) || null : null,
    callout: isPlainObj(sec.callout)
      ? {
          title: sanitizeText(safeString(sec.callout.title)),
          text: sanitizeText(safeString(sec.callout.text)),
          tone: ['good', 'bad', 'note'].includes(sec.callout.tone) ? sec.callout.tone : 'note',
        }
      : null,
    tables: secTables,
    table: secTables[0] || null,
  }
}

export function normalizeExportDocument(input = {}) {
  const doc = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const isPlainObj = v => Boolean(v && typeof v === 'object' && !Array.isArray(v))
  const usedSheetNames = new Set()
  const normalizedTables = new WeakMap()
  const title = sanitizeTitleText(safeString(doc.title)) || '北极星 Polaris 导出报告'
  const generatedAt = sanitizeText(safeString(doc.generatedAt)) || todayShanghai()
  const subtitle = sanitizeTitleText(safeString(doc.subtitle)) || `${generatedAt} · 北极星 Polaris`
  const kind = ['mentors', 'comparison', 'dossier', 'table', 'chat', 'document'].includes(doc.kind)
    ? doc.kind
    : 'document'

  const summaryCards = (Array.isArray(doc.summaryCards) ? doc.summaryCards : [])
    .filter(c => isPlainObj(c) && c.label != null)
    .map(c => ({
      label: sanitizeText(c.label),
      value: c.value == null ? '—' : (sanitizeText(c.value) || '—'),
    }))
    .filter(c => c.label)

  const filtersApplied = (Array.isArray(doc.filtersApplied) ? doc.filtersApplied : [])
    .map(f => sanitizeText(f))
    .filter(Boolean)
  const tables = (Array.isArray(doc.tables) ? doc.tables : [])
    .filter(t => isPlainObj(t) && Array.isArray(t.columns) && t.columns.length > 0)
    .map(t => {
      if (normalizedTables.has(t)) return normalizedTables.get(t)
      const norm = normalizeTable(t, { usedSheetNames })
      normalizedTables.set(t, norm)
      return norm
    })
    .filter(t => t.columns.length > 0)

  const inlineSheetNames = new Set(usedSheetNames)
  const sections = (Array.isArray(doc.sections) ? doc.sections : [])
    .filter(isPlainObj)
    .map(sec => normalizeSection(sec, inlineSheetNames, normalizedTables))

  const charts = (Array.isArray(doc.charts) ? doc.charts : [])
    .map(c => {
      if (!isPlainObj(c)) return null
      const svg = sanitizeSvg(c.svg)
      return svg ? { title: sanitizeTitleText(safeString(c.title) || '统计图表'), svg } : null
    })
    .filter(Boolean)

  const sources = dedupeSources(doc.sources).map(s => ({
    ...s,
    number: sourceNumber(safeString(s.id)),
    safeUrl: typeof s.url === 'string' ? safePublicWebUrl(s.url) : null,
  }))

  return {
    title,
    subtitle,
    kind,
    generatedAt,
    summaryCards,
    filtersApplied,
    sections,
    tables,
    charts,
    sources,
  }
}

export const createExportDocument = normalizeExportDocument

function plainTextFromTokens(tokens = []) {
  return tokens.map(t => (t.children ? plainTextFromTokens(t.children) : (t.text || ''))).join('')
}

function lowerBound(arr, target) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function createLineInlineIndex(src, lineStart, limit, inLink) {
  const tickEnd = new Map()
  const runsByLen = new Map()
  for (let p = lineStart; p < limit; ) {
    if (src[p] === '`') {
      let end = p
      while (end < limit && src[end] === '`') end += 1
      const len = end - p
      let list = runsByLen.get(len)
      if (!list) {
        list = []
        runsByLen.set(len, list)
      }
      list.push({ start: p, end })
      for (let q = p; q < end; q += 1) tickEnd.set(q, end)
      p = end
    } else {
      p += 1
    }
  }

  const findBacktickSpan = start => {
    const runEnd = tickEnd.get(start)
    if (runEnd === undefined) return null
    const tickLen = runEnd - start
    const list = runsByLen.get(tickLen)
    if (!list || list.length === 0) return null
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].start < runEnd) lo = mid + 1
      else hi = mid
    }
    if (lo >= list.length) return null
    const closeRun = list[lo]
    let code = src.slice(runEnd, closeRun.start)
    if (tickLen > 1 && code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim().length > 0) {
      code = code.slice(1, -1)
    }
    return { code, end: closeRun.end }
  }

  const closeParenOf = new Map()
  const parenStack = []
  const closeBracketOf = new Map()
  const bracketStack = []
  for (let p = lineStart; p < limit; p += 1) {
    const ch = src[p]
    if (/\s/.test(ch)) {
      parenStack.length = 0
    } else if (ch === '(') {
      parenStack.push(p)
    } else if (ch === ')' && parenStack.length > 0) {
      closeParenOf.set(parenStack.pop(), p)
    }
  }

  if (!inLink) {
    for (let p = lineStart; p < limit; ) {
      const ch = src[p]
      if (ch === '\\' && p + 1 < limit) {
        p += 2
        continue
      }
      if (ch === '`') {
        const span = findBacktickSpan(p)
        if (span) {
          p = span.end
          continue
        }
        p += 1
        continue
      }
      if (ch === '[') {
        bracketStack.push(p)
      } else if (ch === ']' && bracketStack.length > 0) {
        closeBracketOf.set(bracketStack.pop(), p)
      }
      p += 1
    }
  }

  const linkCache = new Map()
  const parseMarkdownLinkAt = start => {
    if (inLink || src[start] !== '[') return null
    if (linkCache.has(start)) return linkCache.get(start)
    const closeBracket = closeBracketOf.get(start)
    if (closeBracket === undefined || closeBracket <= start + 1 || src[closeBracket + 1] !== '(') {
      linkCache.set(start, null)
      return null
    }
    const closeParen = closeParenOf.get(closeBracket + 1)
    if (closeParen === undefined || closeParen <= closeBracket + 2) {
      linkCache.set(start, null)
      return null
    }
    const res = {
      label: src.slice(start + 1, closeBracket),
      url: src.slice(closeBracket + 2, closeParen),
      end: closeParen + 1,
    }
    linkCache.set(start, res)
    return res
  }

  const starRuns = []
  const doubleUnderPositions = []
  let lastLen2OrMorePos = -1
  let lastClosing1Or3Pos = -1

  for (let p = lineStart; p < limit; ) {
    const ch = src[p]
    if (ch === '\\' && p + 1 < limit) {
      p += 2
      continue
    }
    if (ch === '`') {
      const span = findBacktickSpan(p)
      if (span) {
        p = span.end
        continue
      }
      p += 1
      continue
    }
    if (ch === '[' && !inLink) {
      const link = parseMarkdownLinkAt(p)
      if (link) {
        p = link.end
        continue
      }
      p += 1
      continue
    }
    if (ch === '*') {
      let k = p
      while (k < limit && src[k] === '*') k += 1
      const len = k - p
      const prevWs = /\s/.test(src[p - 1] || '')
      const nextWs = /\s/.test(src[p + 1] || '')
      if (len >= 2) lastLen2OrMorePos = p
      if ((len === 1 || len >= 3) && !prevWs) lastClosing1Or3Pos = p
      starRuns.push({ pos: p, len, prevWs, nextWs })
      p = k
      continue
    }
    if (ch === '_' && src.startsWith('__', p)) {
      let k = p
      while (k < limit && src[k] === '_') k += 1
      doubleUnderPositions.push(k - 2)
      p = k
      continue
    }
    p += 1
  }

  const findClosingStarRun = (from, targetLen) => {
    if (targetLen === 2 && from > lastLen2OrMorePos) return null
    if (targetLen === 1 && from > lastClosing1Or3Pos) return null

    let lo = 0
    let hi = starRuns.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starRuns[mid].pos + starRuns[mid].len <= from) lo = mid + 1
      else hi = mid
    }

    let innerSingle = false
    let innerDouble = false
    let firstSingleFallback = null

    for (let idx = lo; idx < starRuns.length; idx += 1) {
      const r = starRuns[idx]
      const partial = r.pos < from
      const j = partial ? from : r.pos
      const runLen = partial ? r.pos + r.len - from : r.len
      const prevWs = partial ? /\s/.test(src[j - 1] || '') : r.prevWs
      const nextWs = partial ? /\s/.test(src[j + 1] || '') : r.nextWs

      if (targetLen === 2) {
        if (runLen === 2) {
          return {
            pos: j,
            end: j + 2,
            exact: !innerSingle,
            unclosedSingle: innerSingle,
            consumedThirdStar: false,
          }
        }
        if (runLen >= 3) {
          if (innerSingle) {
            return {
              pos: j + runLen - 2,
              end: j + runLen,
              exact: true,
              unclosedSingle: false,
              consumedThirdStar: true,
            }
          }
          return {
            pos: j,
            end: j + 2,
            exact: false,
            unclosedSingle: false,
            consumedThirdStar: false,
          }
        }
        if (runLen === 1) {
          if (!innerSingle && !nextWs) {
            innerSingle = true
          } else if (innerSingle && !prevWs) {
            innerSingle = false
          }
        }
      } else {
        if (runLen === 1 && !prevWs) {
          if (!innerDouble) {
            return { pos: j, end: j + 1, exact: true }
          }
          if (!firstSingleFallback) {
            firstSingleFallback = { pos: j, end: j + 1, exact: false }
          }
        } else if (runLen === 2) {
          innerDouble = !innerDouble
        } else if (runLen >= 3 && !prevWs) {
          if (innerDouble) {
            return { pos: j + runLen - 1, end: j + runLen, exact: true }
          }
          return { pos: j, end: j + 1, exact: false }
        }
      }
    }

    return firstSingleFallback
  }

  const findClosingDoubleUnder = from => {
    if (!doubleUnderPositions.length) return -1
    const idx = lowerBound(doubleUnderPositions, from)
    return idx < doubleUnderPositions.length ? doubleUnderPositions[idx] : -1
  }

  return {
    findBacktickSpan,
    parseMarkdownLinkAt,
    findClosingStarRun,
    findClosingDoubleUnder,
  }
}

function pushTextToken(tokens, text) {
  if (!text) return
  const prev = tokens[tokens.length - 1]
  if (prev && prev.type === 'text' && !prev.children) {
    prev.text += text
    return
  }
  tokens.push({ type: 'text', text })
}

function parseInlineNodes(src, { inLink = false, depth = 0 } = {}) {
  if (!src) return []
  if (depth >= 8) return [{ type: 'text', text: src }]

  const tokens = []
  let i = 0
  let textStart = 0

  const flushText = end => {
    if (end > textStart) {
      pushTextToken(tokens, src.slice(textStart, end))
    }
  }

  let lineStart = 0
  let limit = src.indexOf('\n')
  if (limit < 0) limit = src.length
  let lineIndex = null
  const ensureLineIndex = () => lineIndex || (lineIndex = createLineInlineIndex(src, lineStart, limit, inLink))

  while (i < src.length) {
    if (i >= limit) {
      i += 1
      lineStart = i
      const nl = src.indexOf('\n', lineStart)
      limit = nl >= 0 ? nl : src.length
      lineIndex = null
      continue
    }

    const ch = src[i]

    if (ch === '\\' && i + 1 < limit && /[\\`*_{}[\]()#+\-.!]/.test(src[i + 1])) {
      flushText(i)
      pushTextToken(tokens, src[i + 1])
      i += 2
      textStart = i
      continue
    }

    if (ch === '`') {
      const span = ensureLineIndex().findBacktickSpan(i)
      if (span) {
        flushText(i)
        tokens.push({ type: 'code', text: span.code, code: true })
        i = span.end
        textStart = i
        continue
      }
      while (i < limit && src[i] === '`') i += 1
      continue
    }

    if (ch === '[' && !inLink) {
      const link = ensureLineIndex().parseMarkdownLinkAt(i)
      if (link) {
        flushText(i)
        const children = parseInlineNodes(link.label, { inLink: true, depth: depth + 1 })
        const safe = safePublicWebUrl(link.url)
        if (safe) {
          tokens.push({
            type: 'link',
            text: plainTextFromTokens(children),
            url: safe,
            children,
          })
        } else {
          for (const child of children) {
            if (child.type === 'text' && !child.children) pushTextToken(tokens, child.text)
            else tokens.push(child)
          }
        }
        i = link.end
        textStart = i
        continue
      }
    }

    if (ch === '*') {
      let starLen = 0
      while (i + starLen < limit && src[i + starLen] === '*') starLen += 1
      if (starLen === 3) {
        const idx = ensureLineIndex()
        const close2 = idx.findClosingStarRun(i + 2, 2)
        if (close2 && (!close2.unclosedSingle || close2.consumedThirdStar)) {
          const inner = src.slice(i + 2, close2.pos)
          if (inner) {
            flushText(i)
            const children = parseInlineNodes(inner, { inLink, depth: depth + 1 })
            tokens.push({
              type: 'bold',
              text: plainTextFromTokens(children),
              bold: true,
              children,
            })
            i = close2.end
            textStart = i
            continue
          }
        }
        const close1 = idx.findClosingStarRun(i + 1, 1)
        if (close1) {
          const inner = src.slice(i + 1, close1.pos)
          if (inner) {
            flushText(i)
            const children = parseInlineNodes(inner, { inLink, depth: depth + 1 })
            tokens.push({
              type: 'italic',
              text: plainTextFromTokens(children),
              italic: true,
              children,
            })
            i = close1.end
            textStart = i
            continue
          }
        }
        if (close2) {
          const inner = src.slice(i + 2, close2.pos)
          if (inner) {
            flushText(i)
            const children = parseInlineNodes(inner, { inLink, depth: depth + 1 })
            tokens.push({
              type: 'bold',
              text: plainTextFromTokens(children),
              bold: true,
              children,
            })
            i = close2.end
            textStart = i
            continue
          }
        }
      } else if (starLen === 2) {
        const close2 = ensureLineIndex().findClosingStarRun(i + 2, 2)
        if (close2 && close2.pos > i + 2) {
          flushText(i)
          const children = parseInlineNodes(src.slice(i + 2, close2.pos), { inLink, depth: depth + 1 })
          tokens.push({
            type: 'bold',
            text: plainTextFromTokens(children),
            bold: true,
            children,
          })
          i = close2.end
          textStart = i
          continue
        }
      } else if (starLen === 1 && !/\s/.test(src[i + 1] || '')) {
        const close1 = ensureLineIndex().findClosingStarRun(i + 1, 1)
        if (close1 && close1.pos > i + 1) {
          flushText(i)
          const children = parseInlineNodes(src.slice(i + 1, close1.pos), { inLink, depth: depth + 1 })
          tokens.push({
            type: 'italic',
            text: plainTextFromTokens(children),
            italic: true,
            children,
          })
          i = close1.end
          textStart = i
          continue
        }
      }
      i += starLen
      continue
    }

    if (src.startsWith('__', i) && src[i + 2] !== '_') {
      const close = ensureLineIndex().findClosingDoubleUnder(i + 2)
      if (close > i + 2) {
        flushText(i)
        const children = parseInlineNodes(src.slice(i + 2, close), { inLink, depth: depth + 1 })
        tokens.push({
          type: 'bold',
          text: plainTextFromTokens(children),
          bold: true,
          children,
        })
        i = close + 2
        textStart = i
        continue
      }
    }

    i += 1
  }

  flushText(src.length)
  return tokens
}

export function parseInlineMarkdown(text = '') {
  const src = safeString(text)
  const tokens = parseInlineNodes(src, { inLink: false, depth: 0 })
  return tokens.length ? tokens : [{ type: 'text', text: '' }]
}

export function stripInlineMarkdown(text = '') {
  return plainTextFromTokens(parseInlineMarkdown(text))
}

export function parseMarkdownBlocks(markdown = '') {
  const lines = safeString(markdown).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const splitTableRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, '|'))

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i += 1
      continue
    }
    if (/^```/.test(trimmed)) {
      const codeLines = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      if (codeLines.length) blocks.push({ type: 'code', text: codeLines.join('\n') })
      continue
    }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() })
      i += 1
      continue
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      i += 1
      continue
    }
    if (
      i + 1 < lines.length &&
      trimmed.includes('|') &&
      lines[i + 1].includes('|')
    ) {
      const headers = splitTableRow(trimmed)
      const divider = splitTableRow(lines[i + 1])
      if (headers.length > 0 && headers.length === divider.length && divider.every(c => /^:?-+:?$/.test(c))) {
        const rows = []
        let end = i + 2
        while (end < lines.length && lines[end].includes('|') && lines[end].trim()) {
          const cells = splitTableRow(lines[end])
          if (cells.length !== headers.length && !/^\s*\|/.test(lines[end])) break
          rows.push(cells)
          end += 1
        }
        blocks.push({ type: 'table', headers, rows })
        i = end
        continue
      }
    }
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') })
      continue
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^(?:[-*+]|\d+[.)])\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'list', items })
      continue
    }
    const paraLines = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(?:#{1,4}\s+|```|>\s?|(?:[-*+]|\d+[.)])\s+|[-*_]{3,}$)/.test(lines[i].trim())
    ) {
      if (
        i + 1 < lines.length &&
        lines[i].includes('|') &&
        lines[i + 1].includes('|')
      ) {
        const h = splitTableRow(lines[i])
        const d = splitTableRow(lines[i + 1])
        if (h.length > 0 && h.length === d.length && d.every(c => /^:?-+:?$/.test(c))) break
      }
      paraLines.push(lines[i].trim())
      i += 1
    }
    if (paraLines.length) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') })
    }
  }
  return blocks
}

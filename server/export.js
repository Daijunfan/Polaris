import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Ajv from 'ajv'
import {
  PRESET_META,
  buildArtifactDocument,
  buildChatDocument,
  buildComparisonDocument,
  buildCustomDocument,
  buildDossierDocument,
  buildFromMentors,
  buildInsights,
  exportDocument,
  resolvePresetFilter,
} from '../lib/export/index.js'
import { MENTOR_FILTER_MAP } from '../lib/mentor-filters.js'
import { matchScore } from '../lib/match.js'
import { mentorComparisonFields } from '../lib/fields.js'
import { publicSource } from '../lib/presentation.js'
import { renameWithRetry } from './store.js'

const SUPPORTED_FORMATS = ['xlsx', 'pdf', 'docx', 'md', 'html', 'csv']
const SUPPORTED_PRESETS = Object.keys(PRESET_META)

export const exportToolDefinition = {
  type: 'function',
  function: {
    name: 'export_file',
    description:
      '将查询结果、推荐名单、特定条件筛选导师（如5星高口碑、零风险、可实习不打卡、可指导博士、某学院/某方向）、收藏候选库、导师对比、单人导师档案、或本轮自定义分析/套磁方案导出为可供用户一键下载的文件。支持 Excel(.xlsx)、PDF(.pdf)、Word(.docx)、Markdown(.md)、HTML(.html) 与 CSV(.csv)；暂不支持 PPT/PPTX。用户要求导出任何格式或结果时立即调用，生成持久下载卡片。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: {
          type: 'string',
          enum: SUPPORTED_FORMATS,
          description: '目标文件格式，默认 xlsx；不支持 ppt/pptx。',
        },
        kind: {
          type: 'string',
          enum: ['preset', 'mentors', 'comparison', 'dossier', 'artifact', 'chat', 'custom'],
          description: '导出内容类型，可根据参数自动推断。',
        },
        preset: {
          type: 'string',
          enum: SUPPORTED_PRESETS,
          description: '快捷预设类型：five_star(5星导师)、zero_risk(零风险)、internship_no_clock(可实习不打卡)、doctoral(可导博)、library(我的候选库)、comparison(当前对比)、all(全部导师)。',
        },
        from: {
          type: 'string',
          description: '已有 query 或 search 工具结果引用 ref（如 t1），直接导出该结果行。',
        },
        mentors: {
          type: 'array',
          minItems: 1,
          maxItems: 2000,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              college: { type: 'string' },
            },
          },
          description: '指定要导出的导师列表（可传 key 或 name/college）。',
        },
        name: {
          type: 'string',
          maxLength: 120,
          description: '报告标题或自定义导出文件名（不含后缀亦可）。',
        },
        scope: {
          type: 'string',
          enum: ['library', 'comparison'],
          description: '工作台范围：library 候选库 / comparison 当前对比。',
        },
        filters: {
          type: 'array',
          items: { type: 'string' },
          description: '速查筛选条件 ID，如 rating_5、zero_risk、internship_ok、no_clock、doctoral、no_paper、personal、high_pay 等。',
        },
        colleges: {
          type: 'array',
          items: { type: 'string' },
          description: '限定学院名称列表。',
        },
        query: {
          type: 'string',
          description: '关键词检索（姓名、方向、课题组）。',
        },
        direction_mode: {
          type: 'string',
          enum: ['and', 'or'],
        },
        content: {
          type: 'string',
          description: '用于 custom 导出的 Markdown 正文（如定制分析、套磁邮件、个人建议）。',
        },
        tables: {
          type: 'array',
          items: { type: 'object' },
          description: '用于 custom 导出的结构化表格数组。',
        },
        include_notes: {
          type: 'boolean',
          description: '是否附带用户个人备注与联系进度，默认 true。',
        },
      },
      required: ['format'],
    },
  },
}

const validateExportArgs = new Ajv({ strict: false }).compile(exportToolDefinition.function.parameters)

export function validateExportAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('导出参数必须是对象')
  }
  const format = String(input.format ?? 'xlsx').toLowerCase().trim()
  if (format === 'ppt' || format === 'pptx') {
    throw new Error('暂不支持导出 PPT/PPTX 格式，请选择 Excel (.xlsx)、PDF (.pdf)、Word (.docx) 或 Markdown (.md)')
  }
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`不支持的导出格式：${format || '空'}（支持 ${SUPPORTED_FORMATS.join(' / ')}）`)
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function writeBinaryAtomic(target, body) {
  const dir = path.dirname(target)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    const buf = Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : Buffer.from(String(body ?? ''), 'utf8')
    fs.writeFileSync(tmp, buf, { mode: 0o600 })
    renameWithRetry(tmp, target)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch {}
    throw error
  }
}

function writeJsonAtomic(target, value) {
  writeBinaryAtomic(target, JSON.stringify(value, null, 2))
}

function collectSourcesForRows(rows, data) {
  const allSources = Array.isArray(data?.sources) ? data.sources : []
  if (!allSources.length) return []
  const ids = new Set()
  for (const row of rows || []) {
    for (const id of row?.source_ids || []) {
      if (id) ids.add(id)
    }
    for (const src of row?.sources || []) {
      if (src?.id) ids.add(src.id)
    }
  }
  return allSources.filter(s => ids.has(s.id)).map(publicSource)
}

function filterLabelList({ filters = [], colleges = [], query = '' } = {}) {
  const labels = []
  for (const id of filters || []) {
    const def = MENTOR_FILTER_MAP.get(id)
    labels.push(def ? def.label : id)
  }
  for (const c of colleges || []) {
    if (c) labels.push(String(c))
  }
  if (normalizeText(query)) {
    labels.push(`关键词：${normalizeText(query)}`)
  }
  return labels
}

function resolveMentorEntry(selector, insightState, workbench, data) {
  const { byKey, mentors, list } = insightState
  if (typeof selector === 'string') {
    const hit = byKey.get(selector)
    if (hit) return hit
  }
  if (selector && typeof selector === 'object') {
    if (selector.key && byKey.has(selector.key)) return byKey.get(selector.key)
    const name = normalizeText(selector.name || selector.mentor_name)
    const college = normalizeText(selector.college)
    if (college && name && Object.hasOwn(mentors, `${college}:${name}`)) {
      return mentors[`${college}:${name}`]
    }
    if (name) {
      const candidates = list.filter(m => m.name === name && (!college || m.college === college || m.college?.includes(college)))
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1) return candidates[0]
    }
  }
  if (workbench && selector && typeof selector === 'object' && (selector.key || selector.name)) {
    try {
      const detail = selector.key ? workbench.detail(selector.key) : null
      if (detail) return detail
    } catch {}
  }
  const rawMentors = Array.isArray(data?.mentors) ? data.mentors : []
  if (selector && typeof selector === 'object' && selector.name) {
    const found = rawMentors.find(m => m.name === selector.name && (!selector.college || m.college === selector.college))
    if (found) return found
  }
  return null
}

function inferKind(input, runtime) {
  if (input.kind) return input.kind
  if (input.preset) return 'preset'
  if (input.artifacts || input.artifact) return 'artifact'
  if (input.chatId || input.chat) return 'chat'
  if (input.snapshot || input.scope === 'comparison') return 'comparison'
  if (input.scope === 'library') return 'preset'
  if (input.content || input.tables) return 'custom'
  if (input.from && runtime?.tables?.[input.from]) return 'mentors'
  if (Array.isArray(input.keys) || Array.isArray(input.mentors)) return 'mentors'
  if (Array.isArray(input.filters) || Array.isArray(input.colleges) || normalizeText(input.query)) return 'mentors'
  return 'preset'
}

export function createExportService({ store, getData, getWorkbench, getProfile } = {}) {
  let cachedDataRef = null
  let cachedInsights = null

  function getInsightState() {
    const data = getData?.()
    if (!data) throw new Error('数据尚未就绪')
    if (data !== cachedDataRef || !cachedInsights) {
      cachedInsights = buildInsights(data)
      cachedDataRef = data
    }
    return { data, insightState: cachedInsights }
  }

  const exportsDir = () => path.join(store.dir, 'exports')

  function saveExport({ body, type, extension, filename, count = null, kind = 'export', title = '' }) {
    const id = randomUUID()
    const cleanName = String(filename || `北极星导出.${extension}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    const finalName = cleanName.toLowerCase().endsWith(`.${extension}`) ? cleanName : `${cleanName}.${extension}`
    const dataFile = path.join(exportsDir(), `${id}.${extension}`)
    const metaFile = path.join(exportsDir(), `${id}.meta.json`)
    const size = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body ?? ''), 'utf8')
    const meta = {
      id,
      name: finalName,
      format: extension,
      type,
      size,
      count: Number.isFinite(count) ? count : undefined,
      kind,
      title: title || finalName,
      url: `/api/exports/${id}`,
      createdAt: new Date().toISOString(),
    }
    writeBinaryAtomic(dataFile, body)
    writeJsonAtomic(metaFile, meta)
    return meta
  }

  function getExport(id) {
    if (!/^[\w-]+$/.test(String(id || ''))) {
      throw new Error('导出文件不存在')
    }
    const metaFile = path.join(exportsDir(), `${id}.meta.json`)
    if (!fs.existsSync(metaFile)) {
      throw new Error('导出文件不存在')
    }
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    const dataFile = path.join(exportsDir(), `${id}.${meta.format}`)
    if (!fs.existsSync(dataFile)) {
      throw new Error('导出文件已失效或被清理')
    }
    const body = ['xlsx', 'pdf', 'docx'].includes(meta.format)
      ? fs.readFileSync(dataFile)
      : fs.readFileSync(dataFile, 'utf8')
    return { ...meta, body }
  }

  async function resolveExport(rawInput = {}, runtime = null) {
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {}
    const format = String(input.format || 'xlsx').toLowerCase().trim()
    validateExportAction({ ...input, format })

    const { data, insightState } = getInsightState()
    if (data?.metadata?.vault_locked) {
      throw new Error('导师加密库当前处于锁定状态，请先解锁后再导出')
    }
    const workbench = getWorkbench?.()
    const wsSnapshot = workbench?.snapshot?.()
    const workspaceItems = wsSnapshot?.items || []
    const profile = getProfile?.() || null
    const includeNotes = input.include_notes ?? input.includeNotes ?? true
    const kind = inferKind(input, runtime)
    const customTitle = normalizeText(input.title || input.name)

    let doc
    let count = null

    if (kind === 'preset') {
      const preset = input.preset || (input.scope === 'library' ? 'library' : 'five_star')
      if (preset === 'comparison') {
        const rows = wsSnapshot?.comparison || []
        if (!rows.length) throw new Error('当前对比名单为空，请先选择要对比的导师')
        count = rows.length
        doc = buildComparisonDocument({
          rows,
          insights: insightState,
          fields: input.fields || wsSnapshot?.fields || mentorComparisonFields.map(f => f.key),
          goal: wsSnapshot?.goal || '',
          snapshots: wsSnapshot?.snapshots || [],
          title: customTitle || PRESET_META.comparison.title,
        })
      } else if (preset === 'library') {
        if (!workspaceItems.length) throw new Error('当前候选库为空，请先收藏导师后再导出')
        const rows = workspaceItems.map(item => {
          try {
            return { ...item, ...workbench.detail(item.key) }
          } catch {
            return item
          }
        })
        count = rows.length
        doc = buildFromMentors({
          rows,
          insights: insightState,
          title: customTitle || PRESET_META.library.title,
          includeNotes,
          workspaceItems,
          profile,
          matchFn: matchScore,
          sources: collectSourcesForRows(rows, data),
        })
      } else {
        const filters = Array.isArray(input.filters) ? input.filters : []
        const colleges = Array.isArray(input.colleges) ? input.colleges : []
        const query = normalizeText(input.query)
        const directionMode = input.directionMode || input.direction_mode || 'and'
        const resolved = resolvePresetFilter(preset, {
          allMentors: insightState.list,
          query,
          colleges,
          extraFilters: filters,
          directionMode,
        })
        if (!resolved.mentors.length) throw new Error(`「${resolved.title}」当前匹配 0 位导师`)
        count = resolved.mentors.length
        doc = buildFromMentors({
          rows: resolved.mentors,
          insights: insightState,
          title: customTitle || resolved.title,
          subtitle: resolved.description,
          filtersApplied: filterLabelList({ filters: resolved.filters, colleges, query }),
          includeNotes,
          workspaceItems,
          profile,
          matchFn: matchScore,
          sources: collectSourcesForRows(resolved.mentors, data),
        })
      }
    } else if (kind === 'mentors') {
      let rows = []
      const filters = Array.isArray(input.filters) ? input.filters : []
      const colleges = Array.isArray(input.colleges) ? input.colleges : []
      const query = normalizeText(input.query)
      const directionMode = input.directionMode || input.direction_mode || 'and'
      let filtersApplied = Array.isArray(input.filtersApplied) ? input.filtersApplied : filterLabelList({ filters, colleges, query })

      if (input.from && runtime?.tables?.[input.from]) {
        const table = runtime.tables[input.from]
        rows = (table.rows || []).map(row => {
          const hit = resolveMentorEntry({ key: row.mentor_id, name: row.name || row.mentor_name, college: row.college }, insightState, workbench, data)
          return hit ? { ...hit, ...row } : row
        })
      } else if (Array.isArray(input.keys) && input.keys.length) {
        rows = input.keys.map(k => resolveMentorEntry(k, insightState, workbench, data)).filter(Boolean)
      } else if (Array.isArray(input.mentors) && input.mentors.length) {
        rows = input.mentors.map(m => resolveMentorEntry(m, insightState, workbench, data)).filter(Boolean)
      } else {
        const resolved = resolvePresetFilter('all', {
          allMentors: insightState.list,
          query,
          colleges,
          extraFilters: filters,
          directionMode,
        })
        rows = resolved.mentors
        if (!filtersApplied.length && resolved.filters.length) {
          filtersApplied = filterLabelList({ filters: resolved.filters, colleges, query })
        }
      }

      if (!rows.length) throw new Error('没有符合条件的导师可导出')
      count = rows.length
      doc = buildFromMentors({
        rows,
        insights: insightState,
        title: customTitle || '符合条件的导师名单',
        filtersApplied,
        fields: input.fields,
        includeNotes,
        workspaceItems,
        profile,
        matchFn: matchScore,
        sources: collectSourcesForRows(rows, data),
      })
    } else if (kind === 'comparison') {
      let rows = []
      let snapshotItem = null
      if (input.snapshot && workbench) {
        snapshotItem = workbench.getSnapshot(input.snapshot)
        rows = snapshotItem.rows || []
      } else if (input.from && runtime?.tables?.[input.from]) {
        rows = (runtime.tables[input.from].rows || []).map(row => {
          const hit = resolveMentorEntry({ key: row.mentor_id, name: row.name || row.mentor_name, college: row.college }, insightState, workbench, data)
          return hit ? { ...hit, ...row } : row
        })
      } else if (Array.isArray(input.keys) && input.keys.length) {
        rows = input.keys.map(k => {
          const hit = resolveMentorEntry(k, insightState, workbench, data)
          if (!hit) return null
          try { return { ...hit, ...workbench.detail(hit.key) } } catch { return hit }
        }).filter(Boolean)
      } else if (Array.isArray(input.mentors) && input.mentors.length) {
        rows = input.mentors.map(m => {
          const hit = resolveMentorEntry(m, insightState, workbench, data)
          if (!hit) return null
          try { return { ...hit, ...workbench.detail(hit.key) } } catch { return hit }
        }).filter(Boolean)
      } else {
        rows = wsSnapshot?.comparison || []
      }
      if (!rows.length) throw new Error('当前没有可导出的对比导师，请先选择至少 1 位导师')
      count = rows.length
      doc = buildComparisonDocument({
        rows,
        insights: insightState,
        fields: input.fields || snapshotItem?.fields || wsSnapshot?.fields || defaultExportComparisonFields(),
        goal: snapshotItem?.goal || wsSnapshot?.goal || '',
        snapshots: wsSnapshot?.snapshots || [],
        conclusion: snapshotItem?.conclusion || '',
        title: customTitle || snapshotItem?.name || '导师对比分析报告',
      })
    } else if (kind === 'dossier') {
      const target = input.key || { key: input.key, name: input.name, college: input.college }
      const insight = resolveMentorEntry(target, insightState, workbench, data)
      if (!insight) throw new Error('未找到指定导师的档案资料')
      let detail = null
      if (workbench && insight.key) {
        try { detail = workbench.detail(insight.key) } catch {}
      }
      const savedItem = workspaceItems.find(item => item.key === insight.key) || null
      const match = profile ? matchScore(insight, profile) : null
      count = 1
      doc = buildDossierDocument({
        insight,
        detail,
        match,
        fieldOptions: wsSnapshot?.fieldOptions || mentorComparisonFields,
        savedItem,
      })
    } else if (kind === 'artifact') {
      const artifacts = input.artifacts || (input.artifact ? [input.artifact] : [])
      if (!artifacts.length) throw new Error('没有可导出的推荐或分析结果')
      count = artifacts.reduce((sum, item) => sum + (item?.rows?.length || 0), 0)
      doc = buildArtifactDocument({
        artifacts,
        title: customTitle || undefined,
        subtitle: normalizeText(input.subtitle) || undefined,
      })
    } else if (kind === 'chat') {
      let chat = input.chat
      if (!chat && input.chatId) {
        chat = store.get(input.chatId)
        if (!chat) throw new Error('对话不存在或已移入回收站')
      }
      if (!chat || !Array.isArray(chat.messages)) throw new Error('缺少可导出的对话内容')
      count = chat.messages.length
      doc = buildChatDocument({
        chat,
        messageId: input.messageId || null,
        title: customTitle || chat.title || undefined,
      })
    } else if (kind === 'custom') {
      doc = buildCustomDocument({
        title: customTitle || '北极星 Polaris 专题报告',
        subtitle: normalizeText(input.subtitle) || undefined,
        content: typeof input.content === 'string' ? input.content : '',
        tables: input.tables || [],
        sources: Array.isArray(input.sources) ? input.sources : [],
        summaryCards: Array.isArray(input.summaryCards) ? input.summaryCards : [],
        filtersApplied: Array.isArray(input.filtersApplied) ? input.filtersApplied : [],
      })
    } else {
      throw new Error(`不支持的导出类型：${kind}`)
    }

    const exported = await exportDocument(doc, format, {
      filename: input.filename || customTitle || undefined,
    })
    return {
      ...exported,
      count,
      kind,
      title: doc.title,
    }
  }

  function defaultExportComparisonFields() {
    return mentorComparisonFields.map(f => f.key)
  }

  async function executeTool(rawArgs = {}, runtime = null) {
    if (!validateExportArgs(rawArgs)) {
      const rawFmt = String(rawArgs?.format || '').toLowerCase().trim()
      if (rawFmt === 'ppt' || rawFmt === 'pptx') {
        throw new Error('暂不支持导出 PPT/PPTX 格式，请选择 Excel (.xlsx)、PDF (.pdf)、Word (.docx) 或 Markdown (.md)')
      }
      throw new Error('导出参数无效：' + validateExportArgs.errors.map(err => `${err.instancePath} ${err.message}`).join('；'))
    }
    const resolved = await resolveExport(rawArgs, runtime)
    const saved = saveExport(resolved)
    return {
      message: `已生成「${saved.name}」可供下载。`,
      file: saved,
      sources: [],
    }
  }

  return {
    resolveExport,
    saveExport,
    getExport,
    executeTool,
  }
}

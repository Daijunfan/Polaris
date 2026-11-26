import { createHash } from 'node:crypto'
import {
  contactStatuses,
  defaultComparisonFields,
  differingComparisonFields,
  fieldLabels,
  mentorComparisonFields,
} from '../fields.js'
import { fingerprintAxes, flagText, mentorInsight } from '../insights.js'
import { matchScore } from '../match.js'
import { filterMentors, shortCollegeName, splitMentorColleges } from '../mentor-filters.js'
import {
  formatDisciplineText,
  publicArtifact,
  publicMessage,
  publicMessages,
  publicSource,
} from '../presentation.js'
import { hasProfile, profileOptions } from '../profile.js'
import { createMentorIndex } from '../search.js'
import { formatAcademicSummary, formatTableField } from '../../src/presentation.js'
import {
  RADAR_COLORS,
  dedupeSources,
  isInternalField,
  normalizeExportDocument,
  parseMarkdownBlocks,
  preGuardPublicText,
  radarSvg,
  safeNumber,
  safePublicWebUrl,
  safeString,
  sanitizeText,
  todayShanghai,
} from './model.js'

export const PRESET_META = {
  five_star: {
    id: 'five_star',
    title: '5星高口碑导师名单',
    description: '培养体验评分为 5 分的导师',
    filters: ['rating_5'],
    scope: 'mentors',
  },
  zero_risk: {
    id: 'zero_risk',
    title: '零负面评价导师名单',
    description: '有学生或团队评价记录且无风险标签的导师',
    filters: ['zero_risk'],
    scope: 'mentors',
  },
  internship_no_clock: {
    id: 'internship_no_clock',
    title: '可实习且不打卡导师名单',
    description: '允许实习且不强制打卡坐班的导师',
    filters: ['internship_ok', 'no_clock'],
    scope: 'mentors',
  },
  doctoral: {
    id: 'doctoral',
    title: '可指导博士导师名单',
    description: '具有博士生指导资格的导师',
    filters: ['doctoral'],
    scope: 'mentors',
  },
  library: {
    id: 'library',
    title: '我的候选库导师清单',
    description: '已收藏到工作台候选库的导师',
    filters: [],
    scope: 'library',
  },
  comparison: {
    id: 'comparison',
    title: '导师对比分析报告',
    description: '当前对比队列中的导师多维对比与分析',
    filters: [],
    scope: 'comparison',
  },
  all: {
    id: 'all',
    title: '全部导师汇总名单',
    description: '北极星收录的全部导师公开信息与评价归纳',
    filters: [],
    scope: 'mentors',
  },
}

const VALID_PROFILE_GOALS = new Set(profileOptions.goal.map(g => g.value))
const VALID_PROFILE_STAGES = new Set(profileOptions.stage.map(s => s.value))
const VALID_PROFILE_MUSTS = new Set(profileOptions.musts.map(m => m.value))

function ownLookup(map, key, fallback = undefined) {
  return map && typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : fallback
}

function coerceStr(value, fallback = '') {
  return typeof value === 'string' ? value : (value == null ? fallback : safeString(value, fallback))
}

function coerceOptStr(value) {
  if (typeof value === 'string') return value
  if (value == null) return null
  const s = safeString(value)
  return s || null
}

function coerceFlagsArray(flags) {
  return sanitizeObjectArray(flags)
    .map(f => ({
      ...f,
      id: safeString(f.id),
      tone: safeString(f.tone) || 'note',
      label: safeString(f.label),
      scope: safeString(f.scope),
      conditional: Boolean(f.conditional),
      evidence: Array.isArray(f.evidence) ? f.evidence.map(e => safeString(e)).filter(Boolean) : [],
    }))
    .filter(f => f.label || f.id)
}

function safeComparableValue(val, seen = new WeakSet()) {
  if (val == null) return null
  if (typeof val === 'string' || typeof val === 'boolean') return val
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'bigint') return val.toString()
  if (Array.isArray(val)) {
    if (seen.has(val)) return null
    seen.add(val)
    return val.map(item => safeComparableValue(item, seen))
  }
  return safeString(val) || null
}

function safeDisplayScalar(val) {
  if (val == null) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'string') return val
  if (typeof val === 'boolean') return val
  if (typeof val === 'bigint') return val.toString()
  return safeString(val) || null
}

export function resolvePresetFilter(preset, options = {}) {
  const safeOpts = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const {
    allMentors = [],
    query = '',
    colleges = [],
    extraFilters = [],
    directionMode = 'and',
  } = safeOpts
  const key = safeString(preset).trim()
  const meta = ownLookup(PRESET_META, key)
  if (!meta) {
    throw new Error(`不支持的预设导出类型：${key || '空'}`)
  }
  const safeExtraFilters = Array.isArray(extraFilters) ? extraFilters.filter(f => typeof f === 'string' && f) : []
  const combinedFilters = [...new Set([...(meta.filters || []), ...safeExtraFilters])]
  const safeMentors = sanitizeObjectArray(allMentors).map(m => ({
    ...m,
    name: coerceStr(m.name),
    college: coerceStr(m.college),
    title: coerceOptStr(m.title),
    professional_title: coerceOptStr(m.professional_title),
    group: coerceOptStr(m.group),
    directions: coerceOptStr(m.directions),
    academicSummary: coerceOptStr(m.academicSummary),
    academic_summary: coerceOptStr(m.academic_summary),
    enrollmentSignal: coerceOptStr(m.enrollmentSignal),
    enrollment_signal: coerceOptStr(m.enrollment_signal),
    research_areas: coerceOptStr(m.research_areas),
    personal_directions: coerceOptStr(m.personal_directions),
    email: coerceOptStr(m.email),
    contact_email: coerceOptStr(m.contact_email),
    rating: safeNumber(m.rating),
    stipend: safeNumber(m.stipend),
    stipend_monthly_min: safeNumber(m.stipend_monthly_min),
    stipend_monthly_max: safeNumber(m.stipend_monthly_max),
    ...(m.flags !== undefined ? { flags: coerceFlagsArray(m.flags) } : {}),
  }))
  const safeColleges = Array.isArray(colleges) ? colleges.filter(c => typeof c === 'string' && c) : []
  const safeQuery = safeString(query)
  const safeDirectionMode = directionMode === 'or' ? 'or' : 'and'
  const mentors = meta.scope === 'mentors' && safeMentors.length
    ? filterMentors(safeMentors, {
        query: safeQuery,
        colleges: safeColleges,
        filters: combinedFilters,
        directionMode: safeDirectionMode,
      })
    : []
  return {
    ...meta,
    filters: combinedFilters,
    mentors,
  }
}

/**
 * Node-only equivalent of server/index.mjs insights().
 * Must NOT be placed in lib/insights.js because Vite bundles lib/insights.js for browsers.
 */
export function buildInsights(data) {
  const safeData = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const safeMentors = sanitizeObjectArray(safeData.mentors).map(m => ({
    ...m,
    name: coerceStr(m.name),
    college: coerceStr(m.college),
    group: coerceOptStr(m.group),
    mentor_id: coerceOptStr(m.mentor_id),
    personal_directions: coerceOptStr(m.personal_directions),
    directions: coerceOptStr(m.directions),
    mentor_note: coerceOptStr(m.mentor_note),
    review_text: coerceOptStr(m.review_text),
    group_context: coerceOptStr(m.group_context),
    management: coerceOptStr(m.management),
    internship: coerceOptStr(m.internship),
    graduation: coerceOptStr(m.graduation),
    stipend_text: coerceOptStr(m.stipend_text),
    professional_title: coerceOptStr(m.professional_title),
    research_areas: coerceOptStr(m.research_areas),
    academic_summary: coerceOptStr(m.academic_summary),
    enrollment_signal: coerceOptStr(m.enrollment_signal),
    doctoral_evidence: coerceOptStr(m.doctoral_evidence),
    profile_evidence: coerceOptStr(m.profile_evidence),
    research_evidence: coerceOptStr(m.research_evidence),
    rating: safeNumber(m.rating),
    student_count: safeNumber(m.student_count),
    exam_count: safeNumber(m.exam_count),
    recommended_count: safeNumber(m.recommended_count),
    stipend_monthly_min: safeNumber(m.stipend_monthly_min),
    stipend_monthly_max: safeNumber(m.stipend_monthly_max),
    score_first_max: safeNumber(m.score_first_max),
    score_first_mean: safeNumber(m.score_first_mean),
    source_ids: Array.isArray(m.source_ids) ? m.source_ids.map(s => safeString(s)).filter(Boolean) : [],
  }))
  const safeProfiles = sanitizeObjectArray(safeData.profiles).map(p => ({
    ...p,
    name: coerceStr(p.name),
    college: coerceStr(p.college),
    mentor_id: coerceOptStr(p.mentor_id),
    supervisor_type: coerceStr(p.supervisor_type),
    admissions: coerceStr(p.admissions),
    biography: coerceStr(p.biography),
    projects: coerceStr(p.projects),
    achievements: coerceStr(p.achievements),
    team_description: coerceStr(p.team_description),
    research_areas: coerceOptStr(p.research_areas),
    professional_title: coerceOptStr(p.professional_title),
    source_type: coerceOptStr(p.source_type),
    doctoral_academic: coerceOptStr(p.doctoral_academic),
    doctoral_professional: coerceOptStr(p.doctoral_professional),
    contact_email: coerceOptStr(p.contact_email),
    url: coerceOptStr(p.url),
    source_ids: Array.isArray(p.source_ids) ? p.source_ids.map(s => safeString(s)).filter(Boolean) : [],
  }))
  const safeExams = sanitizeObjectArray(safeData.exams).map(e => ({
    ...e,
    mentor_id: coerceOptStr(e.mentor_id),
    rank_first: safeNumber(e.rank_first),
    score_first: safeNumber(e.score_first),
  }))
  const rawMetadata = safeData.metadata && typeof safeData.metadata === 'object' && !Array.isArray(safeData.metadata)
    ? safeData.metadata
    : {}
  const safeColleges = Array.isArray(rawMetadata.colleges)
    ? rawMetadata.colleges.filter(c => typeof c === 'string' && c)
    : []
  const normalizedData = {
    ...safeData,
    mentors: safeMentors,
    profiles: safeProfiles,
    exams: safeExams,
    metadata: { ...rawMetadata, colleges: safeColleges },
  }

  const names = [...new Set(safeMentors.map(mentor => mentor.name).filter(Boolean))]
  const pages = new Map()
  const normalizeCollege = college =>
    safeColleges.find(name => college?.startsWith(`${name}（`) || college?.startsWith(`${name}(`)) || college

  for (const page of safeProfiles) {
    const normCollege = normalizeCollege(page.college)
    for (const key of [page.mentor_id, `${normCollege}:${page.name}`, `${page.college}:${page.name}`].filter(Boolean)) {
      if (!pages.has(key) || page.source_type === '学校官网') {
        pages.set(key, page)
      }
    }
  }

  const mentors = {}
  const byKey = new Map()
  const list = []
  for (const row of createMentorIndex(normalizedData).rows) {
    const insight = mentorInsight(row, names)
    const page = pages.get(row.mentor_id) || pages.get(`${row.college}:${row.name}`)
    const doctoralPrograms = [
      page?.doctoral_academic && `学博：${page.doctoral_academic}`,
      page?.doctoral_professional && `专博：${page.doctoral_professional}`,
    ].filter(Boolean).join(' · ') || null

    const key = row.mentor_id || `candidate-${createHash('sha256').update(`${row.college || ''}:${row.name}`).digest('hex').slice(0, 12)}`
    const entry = {
      key,
      name: row.name,
      college: row.college,
      group: row.group || null,
      rating: row.rating ?? null,
      doctoral: Boolean(row.can_supervise_doctoral),
      doctoralPrograms,
      title: page?.professional_title || row.professional_title || null,
      email: page?.contact_email || null,
      homepage: page?.source_type === '学校官网' ? page.url : null,
      directions: row.personal_directions || page?.research_areas || row.research_areas || row.directions || null,
      academicSummary: row.academic_summary || null,
      enrollmentSignal: row.enrollment_signal || null,
      biography: page?.biography?.slice(0, 480) || null,
      projects: page?.projects?.slice(0, 520) || null,
      achievements: page?.achievements?.slice(0, 520) || null,
      admissions: page?.admissions?.slice(0, 260) || null,
      scoreFirstMax: row.score_first_max ?? null,
      students: row.student_count ?? null,
      exam: row.exam_count ?? null,
      recommended: row.recommended_count ?? null,
      management: row.management ?? null,
      internship: row.internship ?? null,
      graduation: row.graduation ?? null,
      stipend_text: row.stipend_text ?? null,
      stipend_monthly_min: row.stipend_monthly_min ?? null,
      stipend_monthly_max: row.stipend_monthly_max ?? null,
      personal_directions: row.personal_directions ?? null,
      research_areas: row.research_areas ?? null,
      research_evidence: row.research_evidence ?? null,
      profile_evidence: row.profile_evidence ?? null,
      doctoral_evidence: row.doctoral_evidence ?? null,
      green_flags: row.green_flags ?? null,
      red_flags: row.red_flags ?? null,
      watch_flags: row.watch_flags ?? null,
      actual_supervisor: row.actual_supervisor ?? null,
      source_ids: row.source_ids || [],
      ...insight,
    }
    mentors[`${row.college}:${row.name}`] = entry
    byKey.set(key, entry)
    list.push(entry)
  }

  return {
    mentors,
    byKey,
    list,
    count: list.length,
  }
}

function isPlainObject(val) {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val))
}

function resolveInsightMap(insights) {
  if (!insights || typeof insights !== 'object') return { byNameCollege: null, byKey: null }
  if (isPlainObject(insights.mentors)) {
    const validEntries = Object.values(insights.mentors).filter(isPlainObject)
    let byKey = null
    if (insights.byKey instanceof Map) {
      byKey = insights.byKey
    } else {
      byKey = new Map(validEntries.filter(m => typeof m.key === 'string' && m.key).map(m => [m.key, m]))
    }
    return { byNameCollege: insights.mentors, byKey }
  }
  if (Array.isArray(insights)) {
    const byNameCollege = {}
    const byKey = new Map()
    for (const item of insights) {
      if (!isPlainObject(item)) continue
      const itemCollege = safeString(item.college)
      const itemName = safeString(item.name)
      if (itemCollege && itemName) byNameCollege[`${itemCollege}:${itemName}`] = item
      if (typeof item.key === 'string' && item.key) byKey.set(item.key, item)
    }
    return { byNameCollege, byKey }
  }
  const validEntries = Object.values(insights).filter(isPlainObject)
  const byKey = new Map(validEntries.filter(m => typeof m.key === 'string' && m.key).map(m => [m.key, m]))
  return { byNameCollege: insights, byKey }
}

function lookupInsight(row, insightMaps) {
  if (!isPlainObject(row)) return null
  if (isPlainObject(row.fingerprint) && Array.isArray(row.flags)) return row
  const { byNameCollege, byKey } = insightMaps
  if (typeof row.key === 'string' && row.key && byKey?.has(row.key)) {
    const hit = byKey.get(row.key)
    return isPlainObject(hit) ? hit : null
  }
  const rowCollege = safeString(row.college)
  const rowName = safeString(row.name)
  if (rowCollege && rowName) {
    const hit = ownLookup(byNameCollege, `${rowCollege}:${rowName}`)
    if (isPlainObject(hit)) return hit
  }
  return null
}

function safeFlagText(insight, tone) {
  if (!isPlainObject(insight)) return null
  const flags = coerceFlagsArray(insight.flags).filter(f => f.label)
  if (!flags.length) return null
  return flagText({ flags }, tone)
}

function buildWorkspaceMap(workspaceItems) {
  const map = new Map()
  if (!workspaceItems || typeof workspaceItems !== 'object') return map
  if (Array.isArray(workspaceItems) || Array.isArray(workspaceItems.items)) {
    const items = Array.isArray(workspaceItems) ? workspaceItems : workspaceItems.items
    for (const item of items) {
      if (!isPlainObject(item)) continue
      if (typeof item.key === 'string' && item.key) map.set(item.key, item)
      const itemCollege = safeString(item.college)
      const itemName = safeString(item.name)
      if (itemCollege && itemName) map.set(`${itemCollege}:${itemName}`, item)
    }
    return map
  }
  for (const [k, item] of Object.entries(workspaceItems)) {
    if (!isPlainObject(item)) continue
    map.set(k, item)
    if (typeof item.key === 'string' && item.key) map.set(item.key, item)
    const itemCollege = safeString(item.college)
    const itemName = safeString(item.name)
    if (itemCollege && itemName) map.set(`${itemCollege}:${itemName}`, item)
  }
  return map
}

function sanitizeObjectArray(val) {
  return Array.isArray(val) ? val.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []
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

function distributionBarSvg(title, entries) {
  if (!entries.length) return ''
  const cleanEntries = entries
    .map(r => ({ label: safeString(r?.label), count: safeNumber(r?.count, 0) }))
    .filter(r => r.label)
  if (!cleanEntries.length) return ''
  const max = Math.max(...cleanEntries.map(r => r.count), 1)
  const height = cleanEntries.length * 36 + 28
  const bars = cleanEntries.map((row, idx) => {
    const barW = Math.max(4, Math.round((row.count / max) * 360))
    const shortLabel = row.label.length > 15 ? `${row.label.slice(0, 14)}…` : row.label
    const yText = idx * 36 + 22
    const yRect = idx * 36 + 8
    return [
      `<text x="0" y="${yText}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="12.5" fill="#334155">${escapeXml(shortLabel)}</text>`,
      `<rect x="216" y="${yRect}" width="360" height="18" rx="5" fill="#f1f5f9"/>`,
      `<rect x="216" y="${yRect}" width="${barW}" height="18" rx="5" fill="#1d4b8f"/>`,
      `<text x="${224 + barW}" y="${yText}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="12.5" font-weight="600" fill="#0f172a">${row.count}</text>`,
    ].join('')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 ${height}" width="680" height="${height}" role="img" aria-label="${escapeXml(title)}">${bars}</svg>`
}

function buildFingerprintSheet(rowsWithInsights) {
  const scored = rowsWithInsights.filter(item =>
    isPlainObject(item.insight?.fingerprint) && fingerprintAxes.some(ax => isPlainObject(item.insight.fingerprint[ax.key])),
  )
  if (!scored.length) return null
  return {
    sheetName: '六维画像分值',
    title: '六维培养画像分值（1–5 分制，空值表示暂无记录）',
    description: '基于学生与团队评价归纳的六个维度分值，可用于筛选与横向比较。',
    columns: [
      { key: 'name', label: '导师', type: 'string' },
      { key: 'college', label: '学院', type: 'string' },
      ...fingerprintAxes.map(ax => ({ key: `score_${ax.key}`, label: ax.label, type: 'number' })),
      { key: 'evidence_sources', label: '参考来源数', type: 'number' },
      { key: 'evidence_level', label: '评价完整度', type: 'string' },
    ],
    rows: scored.map(({ row, insight }) => {
      const ev = isPlainObject(insight.evidence) ? insight.evidence : null
      const entry = {
        name: safeString(row.name),
        college: safeString(row.college),
        evidence_sources: safeNumber(ev?.sources),
        evidence_level: safeString(ev?.level) || '暂无评价',
      }
      for (const ax of fingerprintAxes) {
        entry[`score_${ax.key}`] = isPlainObject(insight.fingerprint?.[ax.key])
          ? safeNumber(insight.fingerprint[ax.key].value)
          : null
      }
      return entry
    }),
  }
}

export function buildFromMentors(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const {
    rows = [],
    insights,
    title: rawTitle = '北极星导师清单',
    subtitle: rawSubtitle,
    filtersApplied = [],
    fields,
    includeNotes = true,
    workspaceItems = [],
    profile = null,
    matchFn = matchScore,
    sources = [],
  } = safeOpts

  const title = safeString(rawTitle) || '北极星导师清单'
  const subtitle = safeString(rawSubtitle)
  const safeRows = sanitizeObjectArray(rows)
  const safeFiltersApplied = Array.isArray(filtersApplied) ? filtersApplied.map(f => safeString(f)).filter(Boolean) : []
  const insightMaps = resolveInsightMap(insights)
  const wsMap = buildWorkspaceMap(workspaceItems)
  const safeProfile = isPlainObject(profile)
    ? {
        ...profile,
        goal: typeof profile.goal === 'string' && VALID_PROFILE_GOALS.has(profile.goal) ? profile.goal : null,
        stage: typeof profile.stage === 'string' && VALID_PROFILE_STAGES.has(profile.stage) ? profile.stage : null,
        score: safeNumber(profile.score),
        colleges: Array.isArray(profile.colleges)
          ? profile.colleges.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim())
          : [],
        musts: Array.isArray(profile.musts)
          ? profile.musts.filter(m => typeof m === 'string' && VALID_PROFILE_MUSTS.has(m))
          : [],
        interests: typeof profile.interests === 'string' ? profile.interests : '',
        program: typeof profile.program === 'string' ? profile.program : null,
        notes: typeof profile.notes === 'string' ? profile.notes : '',
      }
    : null
  const useProfile = Boolean(safeProfile && hasProfile(safeProfile))
  const safeMatchFn = typeof matchFn === 'function' ? matchFn : matchScore

  const enriched = safeRows.map(raw => {
    const insight = lookupInsight(raw, insightMaps)
    const rawKey = typeof raw.key === 'string' ? raw.key : ''
    const rawCollege = safeString(raw.college)
    const rawName = safeString(raw.name)
    const saved = (rawKey ? wsMap.get(rawKey) : null) || (rawCollege && rawName ? wsMap.get(`${rawCollege}:${rawName}`) : null)
    const safeFingerprint = isPlainObject(insight?.fingerprint)
      ? Object.fromEntries(
          Object.entries(insight.fingerprint).map(([k, v]) => {
            if (!isPlainObject(v)) return [k, null]
            const numVal = safeNumber(v.value)
            return [k, numVal != null ? { ...v, value: numVal } : null]
          }),
        )
      : {}
    const matchInput = insight
      ? {
          ...insight,
          college: safeString(insight.college) || rawCollege,
          directions: coerceOptStr(insight.directions),
          academicSummary: coerceOptStr(insight.academicSummary),
          quote: coerceOptStr(insight.quote),
          rating: safeNumber(insight.rating),
          flags: coerceFlagsArray(insight.flags),
          fingerprint: safeFingerprint,
          evidence: isPlainObject(insight.evidence)
            ? {
                ...insight.evidence,
                sources: safeNumber(insight.evidence.sources, 0),
                level: safeString(insight.evidence.level),
              }
            : null,
        }
      : null
    const match = useProfile && matchInput ? safeMatchFn(matchInput, safeProfile) : null
    const doctoralFlag = raw.can_supervise_doctoral ?? insight?.doctoral ?? false
    const greenFlags = raw.green_flags != null ? (safeString(raw.green_flags) || null) : safeFlagText(insight, 'good')
    const redFlags = raw.red_flags != null ? (safeString(raw.red_flags) || null) : safeFlagText(insight, 'bad')
    const watchFlags = raw.watch_flags != null ? (safeString(raw.watch_flags) || null) : safeFlagText(insight, 'note')
    const supervisor = raw.actual_supervisor != null
      ? (safeString(raw.actual_supervisor) || null)
      : (isPlainObject(insight?.supervisor) ? (safeString(insight.supervisor.name) || null) : null)
    const savedStatus = safeString(saved?.status)
    const rawStatus = safeString(raw.status)
    const contactStatus = saved
      ? (safeString(saved.contact_status) || (savedStatus ? ownLookup(contactStatuses, savedStatus, savedStatus) : ''))
      : (safeString(raw.contact_status) || (rawStatus ? ownLookup(contactStatuses, rawStatus, rawStatus) : ''))
    const note = safeString(saved?.note) || safeString(raw.note)

    return {
      row: {
        name: rawName || '未知导师',
        college: rawCollege,
        group: coerceOptStr(raw.group) ?? coerceOptStr(insight?.group) ?? null,
        professional_title: coerceOptStr(raw.professional_title) ?? coerceOptStr(raw.title) ?? coerceOptStr(insight?.title) ?? null,
        rating: safeNumber(raw.rating) ?? safeNumber(insight?.rating) ?? null,
        can_supervise_doctoral: Boolean(doctoralFlag),
        green_flags: greenFlags,
        red_flags: redFlags,
        watch_flags: watchFlags,
        actual_supervisor: supervisor,
        personal_directions: coerceOptStr(raw.personal_directions) ?? coerceOptStr(raw.directions) ?? coerceOptStr(insight?.directions) ?? null,
        directions: coerceOptStr(raw.directions) ?? coerceOptStr(insight?.directions) ?? null,
        academic_summary: coerceOptStr(raw.academic_summary) ?? coerceOptStr(insight?.academicSummary) ?? null,
        enrollment_signal: coerceOptStr(raw.enrollment_signal) ?? coerceOptStr(insight?.enrollmentSignal) ?? null,
        management: coerceOptStr(raw.management) ?? coerceOptStr(insight?.management) ?? null,
        internship: coerceOptStr(raw.internship) ?? coerceOptStr(insight?.internship) ?? null,
        graduation: coerceOptStr(raw.graduation) ?? coerceOptStr(insight?.graduation) ?? null,
        stipend_text: coerceOptStr(raw.stipend_text) ?? coerceOptStr(insight?.stipend_text) ?? null,
        student_count: safeNumber(raw.student_count) ?? safeNumber(insight?.students) ?? null,
        exam_count: safeNumber(raw.exam_count) ?? safeNumber(insight?.exam) ?? null,
        recommended_count: safeNumber(raw.recommended_count) ?? safeNumber(insight?.recommended) ?? null,
        research_evidence: coerceOptStr(raw.research_evidence) ?? coerceOptStr(insight?.research_evidence) ?? null,
        profile_evidence: coerceOptStr(raw.profile_evidence) ?? coerceOptStr(insight?.profile_evidence) ?? null,
        doctoral_evidence: coerceOptStr(raw.doctoral_evidence) ?? coerceOptStr(insight?.doctoralPrograms) ?? coerceOptStr(insight?.doctoral_evidence) ?? null,
        match_score: safeNumber(match?.score),
        contact_status: contactStatus || null,
        note: note || null,
        sources: sanitizeObjectArray(raw.sources),
      },
      insight,
      match,
      saved,
    }
  })

  const hasSavedInfo = includeNotes && enriched.some(item => item.row.contact_status || item.row.note)
  const defaultCols = [
    'name',
    'college',
    'group',
    'professional_title',
    'rating',
    'can_supervise_doctoral',
    ...(useProfile ? ['match_score'] : []),
    'green_flags',
    'red_flags',
    'watch_flags',
    'actual_supervisor',
    'personal_directions',
    'management',
    'internship',
    'graduation',
    'stipend_text',
    'student_count',
    'exam_count',
    'recommended_count',
    ...(hasSavedInfo ? ['contact_status', 'note'] : []),
  ]

  const safeFields = Array.isArray(fields)
    ? fields.filter(k => typeof k === 'string' && k && !isInternalField(k))
    : []
  const fieldKeys = safeFields.length
    ? [...new Set(['name', 'college', ...safeFields, ...(hasSavedInfo ? ['contact_status', 'note'] : [])])].filter(k => k && !isInternalField(k))
    : defaultCols

  const customLabels = {
    professional_title: '职称',
    group: '招生组',
    match_score: '画像契合度（%）',
    contact_status: '我的联系进度',
    note: '我的备注',
  }

  const columns = fieldKeys.map(key => ({
    key,
    label: ownLookup(customLabels, key) || ownLookup(fieldLabels, key, key),
    type: ['rating', 'student_count', 'exam_count', 'recommended_count', 'match_score'].includes(key)
      ? 'number'
      : key === 'can_supervise_doctoral'
        ? 'boolean'
        : 'string',
  }))

  const colleges = new Set(enriched.flatMap(item => splitMentorColleges(item.row.college)))
  const rated = enriched.map(item => item.row.rating).filter(v => typeof v === 'number' && Number.isFinite(v))
  const avgRating = rated.length ? (rated.reduce((s, v) => s + v, 0) / rated.length).toFixed(2) : '—'
  const doctoralCount = enriched.filter(item => item.row.can_supervise_doctoral).length

  const summaryCards = [
    { label: '导师人数', value: `${enriched.length} 位` },
    { label: '涉及学院', value: `${colleges.size} 个` },
    { label: '平均评分', value: avgRating === '—' ? '暂无评分' : `${avgRating} / 5` },
    { label: '博导人数', value: `${doctoralCount} 位` },
  ]
  if (useProfile) {
    const matched = enriched.map(i => i.match?.score).filter(v => typeof v === 'number')
    if (matched.length) {
      summaryCards.push({
        label: '平均契合度',
        value: `${Math.round(matched.reduce((s, v) => s + v, 0) / matched.length)}%`,
      })
    }
  }

  const tables = [
    {
      sheetName: '导师清单',
      title,
      description: `共 ${enriched.length} 位导师`,
      columns,
      rows: enriched.map(item => item.row),
    },
  ]
  const fpSheet = buildFingerprintSheet(enriched)
  if (fpSheet) tables.push(fpSheet)

  const sections = []
  if (enriched.length > 0 && enriched.length <= 15) {
    sections.push({
      heading: '重点摘要',
      level: 2,
      bullets: enriched.map(({ row }) => {
        const bits = [
          row.college,
          row.rating != null ? `评分 ${row.rating}/5` : null,
          row.green_flags ? `优点：${row.green_flags}` : null,
          row.red_flags ? `风险：${row.red_flags}` : null,
        ].filter(Boolean)
        return `**${row.name}**（${bits.join(' · ')}）`
      }),
    })
  }

  const allSources = dedupeSources([
    ...sanitizeObjectArray(sources),
    ...enriched.flatMap(item => item.row.sources || []),
  ])

  return normalizeExportDocument({
    title,
    subtitle: subtitle || `${todayShanghai()} · 北极星 Polaris · 共 ${enriched.length} 位导师`,
    kind: 'mentors',
    summaryCards,
    filtersApplied: safeFiltersApplied,
    sections,
    tables,
    sources: allSources,
  })
}

export function buildComparisonDocument(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const {
    rows = [],
    insights,
    fields = defaultComparisonFields,
    goal: rawGoal = '',
    snapshots = [],
    conclusion: rawConclusion = '',
    title: rawTitle = '导师对比分析报告',
  } = safeOpts

  const title = safeString(rawTitle) || '导师对比分析报告'
  const goal = safeString(rawGoal)
  const conclusion = safeString(rawConclusion)
  const safeRows = sanitizeObjectArray(rows)
  const safeSnapshots = sanitizeObjectArray(snapshots)
  const insightMaps = resolveInsightMap(insights)
  const rawFields = Array.isArray(fields) && fields.length ? fields : defaultComparisonFields
  const effectiveFields = rawFields.filter(key => typeof key === 'string' && key && !isInternalField(key))

  const enriched = safeRows.map(raw => {
    const insight = lookupInsight(raw, insightMaps)
    const coercedFields = {}
    for (const key of effectiveFields) {
      if (Object.hasOwn(raw, key)) {
        coercedFields[key] = safeComparableValue(raw[key])
      }
    }
    return {
      row: {
        ...raw,
        ...coercedFields,
        name: safeString(raw.name) || '未知导师',
        college: safeString(raw.college),
        professional_title: safeString(raw.professional_title) || safeString(raw.title) || safeString(insight?.title),
        title: safeString(raw.title),
        rating: raw.rating !== undefined ? safeNumber(raw.rating) : safeNumber(insight?.rating),
        green_flags: raw.green_flags != null ? (safeString(raw.green_flags) || null) : safeFlagText(insight, 'good'),
        red_flags: raw.red_flags != null ? (safeString(raw.red_flags) || null) : safeFlagText(insight, 'bad'),
        watch_flags: raw.watch_flags != null ? (safeString(raw.watch_flags) || null) : safeFlagText(insight, 'note'),
        actual_supervisor: raw.actual_supervisor != null
          ? (safeString(raw.actual_supervisor) || null)
          : (isPlainObject(insight?.supervisor) ? (safeString(insight.supervisor.name) || null) : null),
        can_supervise_doctoral: Boolean(raw.can_supervise_doctoral ?? insight?.doctoral ?? false),
        contact_status: safeString(raw.contact_status) || null,
        note: safeString(raw.note) || null,
      },
      insight,
    }
  })

  const dupNames = new Set()
  const seenNames = new Set()
  for (const item of enriched) {
    if (seenNames.has(item.row.name)) dupNames.add(item.row.name)
    seenNames.add(item.row.name)
  }

  const radarSeries = enriched
    .filter(item => isPlainObject(item.insight?.fingerprint))
    .slice(0, 4)
    .map((item, idx) => ({
      name: dupNames.has(item.row.name)
        ? `${item.row.name}（${shortCollegeName(item.row.college)}）`
        : item.row.name,
      fingerprint: item.insight.fingerprint,
      color: RADAR_COLORS[idx % RADAR_COLORS.length],
    }))

  const radar = radarSeries.length ? radarSvg(radarSeries, { size: 260, showLabels: true }) : null

  const winners = fingerprintAxes.map(axis => {
    const scored = enriched
      .map((item, index) => ({
        index,
        value: isPlainObject(item.insight?.fingerprint?.[axis.key]) ? safeNumber(item.insight.fingerprint[axis.key].value) : null,
      }))
      .filter(s => s.value != null)
    if (scored.length < 2) return null
    const best = Math.max(...scored.map(s => s.value))
    const top = scored.filter(s => s.value === best)
    if (top.length !== 1) return null
    const winRow = enriched[top[0].index].row
    const displayName = dupNames.has(winRow.name)
      ? `${winRow.name}（${shortCollegeName(winRow.college)}）`
      : winRow.name
    return {
      axis: axis.label,
      winner: displayName,
      winnerIndex: top[0].index,
      value: best,
    }
  }).filter(Boolean)

  const diffRows = enriched.map(({ row }) => {
    const obj = Object.create(null)
    for (const key of effectiveFields) {
      obj[key] = Object.hasOwn(row, key) ? safeComparableValue(row[key]) : null
    }
    return obj
  })
  const changed = differingComparisonFields(diffRows, effectiveFields)
  const colleges = [...new Set(enriched.flatMap(i => splitMentorColleges(i.row.college)))]
  const hasNotes = enriched.some(i => i.row.contact_status || i.row.note)

  const matrixColumns = [
    { key: 'name', label: '导师', type: 'string' },
    { key: 'college', label: '学院', type: 'string' },
    ...effectiveFields.map(key => ({
      key,
      label: ownLookup(fieldLabels, key, key),
      type: ['rating', 'student_count', 'exam_count', 'recommended_count'].includes(key)
        ? 'number'
        : key === 'can_supervise_doctoral'
          ? 'boolean'
          : 'string',
    })),
    ...(winners.length ? [{ key: 'won_axes', label: '胜出维度', type: 'string' }] : []),
    ...(hasNotes ? [{ key: 'contact_status', label: '我的联系进度', type: 'string' }, { key: 'note', label: '我的备注', type: 'string' }] : []),
  ]

  const matrixRows = enriched.map(({ row }, idx) => ({
    ...row,
    won_axes: winners.filter(w => w.winnerIndex === idx).map(w => `${w.axis}(${w.value})`).join('、') || '—',
  }))

  const tables = [
    {
      sheetName: '对比矩阵',
      title: '导师核心维度对比矩阵',
      description: goal ? `比较目标：${goal} · 共 ${enriched.length} 位导师` : `共 ${enriched.length} 位导师 · ${effectiveFields.length} 项维度`,
      columns: matrixColumns,
      rows: matrixRows,
    },
  ]
  const fpSheet = buildFingerprintSheet(enriched)
  if (fpSheet) tables.push(fpSheet)

  const sections = []
  sections.push({
    heading: goal ? `对比概览 · ${goal}` : '对比概览',
    level: 2,
    radarSvg: radar,
    paragraphs: [
      `共对比 ${enriched.length} 位导师，覆盖 ${colleges.length} 个学院、${effectiveFields.length} 项比较维度。`,
      changed.length
        ? `存在明显差异的维度：${changed.map(k => ownLookup(fieldLabels, k, k)).join('、')}。`
        : '所选维度在当前对比导师间差异较小。',
    ],
    bullets: winners.map(w => `**${w.axis}**：${w.winner} 领先（${w.value} / 5）`),
  })

  for (const { row, insight } of enriched) {
    const badges = coerceFlagsArray(insight?.flags).filter(f => f.label).map(f => ({ label: f.label, tone: f.tone }))
    const mentorTitle = safeString(row.professional_title) || safeString(row.title)
    const kvPairs = effectiveFields
      .map(key => {
        if (!Object.hasOwn(row, key)) return null
        const rawVal = row[key]
        if (rawVal == null || rawVal === '') return null
        const val = typeof rawVal === 'boolean'
          ? (rawVal ? '是' : '否')
          : typeof rawVal === 'number'
            ? (Number.isFinite(rawVal) ? rawVal : null)
            : typeof rawVal === 'string'
              ? formatTableField(key, rawVal, mentorTitle)
              : (safeString(rawVal) || null)
        return val != null && val !== '' ? { label: ownLookup(fieldLabels, key, key), value: val } : null
      })
      .filter(Boolean)
    if (row.contact_status) kvPairs.push({ label: '我的联系进度', value: row.contact_status })
    sections.push({
      heading: `${row.name}${row.college ? ` · ${row.college}` : ''}`,
      level: 3,
      badges,
      kvPairs,
      callout: row.note
        ? { title: '我的备注', text: row.note, tone: 'note' }
        : row.actual_supervisor
          ? { title: '实际带教提示', text: `评价提及实际带教人为 ${row.actual_supervisor}`, tone: 'bad' }
          : null,
    })
  }

  if (conclusion || safeSnapshots.length) {
    sections.push({
      heading: '方案结论与历史记录',
      level: 2,
      callout: conclusion ? { title: '我的选择结论', text: conclusion, tone: 'good' } : null,
      bullets: safeSnapshots.map(s => {
        const createdRaw = typeof s.createdAt === 'string' || typeof s.createdAt === 'number' || s.createdAt instanceof Date
          ? s.createdAt
          : null
        const dt = createdRaw != null ? new Date(createdRaw) : null
        const dateStr = dt && !Number.isNaN(dt.getTime())
          ? dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
          : '—'
        const count = Array.isArray(s.rows) ? s.rows.length : 0
        return `${safeString(s.name) || '未命名方案'} · ${dateStr} · ${count} 位导师`
      }),
    })
  }

  const charts = []
  if (enriched.length >= 2) {
    const collegeCounts = colleges.map(c => ({
      label: c,
      count: enriched.filter(i => splitMentorColleges(i.row.college).includes(c)).length,
    })).sort((a, b) => b.count - a.count)
    if (collegeCounts.length) {
      charts.push({ title: '学院分布', svg: distributionBarSvg('学院分布', collegeCounts) })
    }
    const ratings = [...new Set(enriched.map(i => i.row.rating).filter(v => v != null))]
      .sort((a, b) => b - a)
      .map(r => ({ label: `${r} 分`, count: enriched.filter(i => i.row.rating === r).length }))
    if (ratings.length) {
      charts.push({ title: '培养体验评分分布', svg: distributionBarSvg('培养体验评分分布', ratings) })
    }
  }

  const sources = dedupeSources(enriched.flatMap(i => sanitizeObjectArray(i.row.sources)))

  return normalizeExportDocument({
    title,
    subtitle: `${todayShanghai()} · 北极星 Polaris · ${enriched.length} 位导师对比`,
    kind: 'comparison',
    summaryCards: [
      { label: '对比导师', value: `${enriched.length} 位` },
      { label: '涉及学院', value: `${colleges.length} 个` },
      { label: '对比维度', value: `${effectiveFields.length} 项` },
      { label: '差异维度', value: `${changed.length} 项` },
      ...(goal ? [{ label: '比较目标', value: goal }] : []),
    ],
    filtersApplied: goal ? [`比较目标：${goal}`] : [],
    sections,
    tables,
    charts,
    sources,
  })
}

export function buildDossierDocument(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const {
    insight,
    detail,
    match = null,
    fieldOptions = mentorComparisonFields,
    savedItem = null,
  } = safeOpts
  const safeInsight = isPlainObject(insight) ? insight : null
  const safeDetail = isPlainObject(detail) ? detail : null
  if (!safeInsight && !safeDetail) {
    throw new Error('缺少导师档案数据')
  }
  const name = safeString(safeInsight?.name) || safeString(safeDetail?.name) || '未知导师'
  const college = safeString(safeInsight?.college) || safeString(safeDetail?.college)
  const group = safeString(safeInsight?.group) || safeString(safeDetail?.group) || null
  const title = safeString(safeInsight?.title) || safeString(safeDetail?.professional_title) || safeString(safeDetail?.title) || null
  const rating = safeNumber(safeInsight?.rating) ?? safeNumber(safeDetail?.rating) ?? null
  const doctoral = Boolean(safeInsight?.doctoral ?? safeDetail?.can_supervise_doctoral)
  const directions = safeString(safeInsight?.directions) || safeString(safeDetail?.personal_directions) || safeString(safeDetail?.directions) || null
  const flags = coerceFlagsArray(safeInsight?.flags).filter(f => f.label)
  const bad = flags.filter(f => f.tone === 'bad')
  const good = flags.filter(f => f.tone === 'good')
  const notes = flags.filter(f => f.tone === 'note')
  const fingerprint = isPlainObject(safeInsight?.fingerprint) ? safeInsight.fingerprint : {}
  const detailSources = sanitizeObjectArray(safeDetail?.sources)
  const rawEv = isPlainObject(safeInsight?.evidence) ? safeInsight.evidence : null
  const evidence = rawEv
    ? { sources: safeNumber(rawEv.sources, detailSources.length), level: safeString(rawEv.level) || '暂无评价' }
    : { sources: detailSources.length, level: '暂无评价' }
  const students = safeNumber(safeInsight?.students) ?? safeNumber(safeDetail?.student_count) ?? null
  const exam = safeNumber(safeInsight?.exam) ?? safeNumber(safeDetail?.exam_count) ?? null
  const recommended = safeNumber(safeInsight?.recommended) ?? safeNumber(safeDetail?.recommended_count) ?? null
  const safeMatch = isPlainObject(match) ? match : null
  const matchScoreVal = safeNumber(safeMatch?.score)
  const matchHits = Array.isArray(safeMatch?.hits) ? safeMatch.hits.map(x => safeString(x)).filter(Boolean) : []
  const matchMisses = Array.isArray(safeMatch?.misses) ? safeMatch.misses.map(x => safeString(x)).filter(Boolean) : []
  const rawSupervisor = isPlainObject(safeInsight?.supervisor) ? safeInsight.supervisor : null
  const safeSupervisor = rawSupervisor && safeString(rawSupervisor.name)
    ? { name: safeString(rawSupervisor.name), evidence: safeString(rawSupervisor.evidence) }
    : null

  const summaryCards = [
    { label: '学院 / 组别', value: [college, group].filter(Boolean).join(' · ') || '—' },
    { label: '职称 / 资格', value: [title, doctoral ? '博士生导师' : null].filter(Boolean).join(' · ') || '—' },
    { label: '培养体验评分', value: rating != null ? `${rating} / 5` : '暂无评分' },
    { label: '评价完整度', value: `${evidence.level || '暂无评价'}（${evidence.sources ?? 0} 项来源）` },
  ]
  if (matchScoreVal != null) {
    summaryCards.push({ label: '画像契合度', value: `${matchScoreVal}%` })
  }
  if (students != null) {
    summaryCards.push({ label: '2026 名册人数', value: `${students} 人（研${exam ?? 0} / 保${recommended ?? 0}）` })
  }

  const sections = []

  const insightEmail = safeString(safeInsight?.email)
  const insightHomepage = typeof safeInsight?.homepage === 'string' ? safeInsight.homepage : ''
  const introKv = [
    directions && { label: '研究方向', value: formatDisciplineText(directions) },
    insightEmail && { label: '公开邮箱', value: insightEmail },
    insightHomepage && safePublicWebUrl(insightHomepage) && { label: '官网主页', value: insightHomepage },
    safeMatch && {
      label: '画像契合说明',
      value: [
        matchScoreVal != null ? `契合度 ${matchScoreVal}%` : null,
        matchHits.length ? `满足：${matchHits.join('、')}` : null,
        matchMisses.length ? `冲突：${matchMisses.join('、')}` : null,
      ].filter(Boolean).join('；'),
    },
  ].filter(Boolean)

  sections.push({
    heading: '个人简介与方向联系',
    level: 2,
    kvPairs: introKv,
    quote: safeString(safeInsight?.quote) || null,
    callout: safeSupervisor
      ? { title: `实际带教提示：${safeSupervisor.name}`, text: safeSupervisor.evidence, tone: 'bad' }
      : null,
  })

  const hasFingerprint = fingerprintAxes.some(ax => isPlainObject(fingerprint[ax.key]))
  if (hasFingerprint) {
    sections.push({
      heading: '六维培养画像',
      level: 2,
      radarSvg: radarSvg([{ name, fingerprint }], { size: 224, showLabels: true }),
      kvPairs: fingerprintAxes.map(ax => {
        const fpAxis = isPlainObject(fingerprint[ax.key]) ? fingerprint[ax.key] : null
        const fpVal = safeNumber(fpAxis?.value)
        const fpEvidence = Array.isArray(fpAxis?.evidence) ? fpAxis.evidence.map(e => safeString(e)).filter(Boolean) : []
        return {
          label: ax.label,
          value: fpVal != null
            ? `${fpVal} / 5${fpEvidence.length ? `（${fpEvidence.join('；')}）` : ''}`
            : '暂无评价记录',
        }
      }),
    })
  }

  sections.push({
    heading: '评价标签与风险提示',
    level: 2,
    badges: flags.map(f => ({
      label: f.scope === '团队' ? `${f.label}[组]` : f.label,
      tone: f.tone,
      detail: f.evidence.join('；'),
    })),
    bullets: [
      ...bad.map(f => `[风险] **${f.label}**${f.scope === '团队' ? '（团队资料）' : ''}：${f.evidence.join('；')}`),
      ...good.map(f => `[认可] **${f.label}**${f.scope === '团队' ? '（团队资料）' : ''}：${f.evidence.join('；')}`),
      ...notes.map(f => `[留意] **${f.label}**：${f.evidence.join('；')}`),
    ],
    paragraphs: !flags.length ? ['暂无具体标签归纳，详见下方指导学科与公开资料。'] : [],
  })

  const detailInternship = safeString(safeDetail?.internship)
  const detailStipend = safeString(safeDetail?.stipend_text)
  const detailManagement = safeString(safeDetail?.management)
  const detailGraduation = safeString(safeDetail?.graduation)
  const trainFacts = [
    detailInternship && { label: '实习安排', value: detailInternship },
    detailStipend && { label: '补助标准', value: detailStipend },
    detailManagement && { label: '日常管理', value: detailManagement },
    detailGraduation && { label: '毕业与去向', value: detailGraduation },
  ].filter(Boolean)
  if (trainFacts.length) {
    sections.push({
      heading: '培养细节记录',
      level: 2,
      kvPairs: trainFacts,
    })
  }

  const admissionsText = [safeString(safeInsight?.doctoralPrograms), safeString(safeInsight?.admissions)].filter(Boolean).map(formatDisciplineText).join('\n')
  const rawAcademic = safeString(safeInsight?.academicSummary) || safeString(safeDetail?.academic_summary)
  const academicText = rawAcademic ? formatAcademicSummary(rawAcademic, title || '') : null
  const enrollmentText = safeString(safeInsight?.enrollmentSignal) || safeString(safeDetail?.enrollment_signal)
  const biographyText = safeString(safeInsight?.biography)
  const projectsText = safeString(safeInsight?.projects)
  const achievementsText = safeString(safeInsight?.achievements)
  const suppCards = [
    admissionsText && { label: '指导学科与招生专业', value: admissionsText },
    academicText && { label: '学术与科研平台', value: academicText },
    enrollmentText && { label: '生源与学生选择', value: enrollmentText },
    biographyText && { label: '教师简介', value: formatDisciplineText(biographyText) },
    projectsText && { label: '科研项目', value: formatDisciplineText(projectsText) },
    achievementsText && { label: '代表性成果与奖项', value: formatDisciplineText(achievementsText) },
  ].filter(Boolean)
  if (suppCards.length) {
    sections.push({
      heading: '学术背景与公开档案',
      level: 2,
      kvPairs: suppCards,
    })
  }

  const safeSavedItem = isPlainObject(savedItem) ? savedItem : null
  const effectiveSaved = safeSavedItem || (safeString(safeDetail?.note) || safeString(safeDetail?.status) ? safeDetail : null)
  if (effectiveSaved) {
    const savedNote = safeString(effectiveSaved.note)
    const savedContactStatus = safeString(effectiveSaved.contact_status)
    const statusKey = safeString(effectiveSaved.status)
    if (savedNote || savedContactStatus || statusKey) {
      const statusLabel = statusKey ? ownLookup(contactStatuses, statusKey, statusKey) : statusKey
      const statusText = savedContactStatus || statusLabel || '待比较'
      sections.push({
        heading: '我的候选库记录',
        level: 2,
        kvPairs: [{ label: '联系进度', value: statusText }],
        callout: savedNote ? { title: '个人备注', text: savedNote, tone: 'note' } : null,
      })
    }
  }

  // Excel multi-sheet tables
  const overviewRows = [
    { field: '导师姓名', value: name },
    { field: '所在学院', value: college },
    ...(group ? [{ field: '招生组', value: group }] : []),
    ...(title ? [{ field: '职称', value: title }] : []),
    { field: '培养体验评分', value: rating != null ? `${rating} / 5` : '暂无评分' },
    { field: '可指导博士', value: doctoral ? '是' : '否' },
    ...(directions ? [{ field: '研究方向', value: formatDisciplineText(directions) }] : []),
    ...(insightEmail ? [{ field: '公开邮箱', value: insightEmail }] : []),
    ...(insightHomepage && safePublicWebUrl(insightHomepage) ? [{ field: '官网主页', value: insightHomepage }] : []),
    ...(matchScoreVal != null ? [{ field: '画像契合度', value: `${matchScoreVal}%` }] : []),
  ]
  const safeFieldOptions = Array.isArray(fieldOptions) ? fieldOptions : []
  if (safeDetail) {
    for (const rawOpt of safeFieldOptions) {
      const f = typeof rawOpt === 'string'
        ? { key: rawOpt, label: ownLookup(fieldLabels, rawOpt, rawOpt) }
        : (isPlainObject(rawOpt) ? rawOpt : null)
      if (!f || typeof f.key !== 'string' || !f.key || isInternalField(f)) continue
      if (['rating', 'green_flags', 'red_flags', 'actual_supervisor'].includes(f.key)) continue
      const rawVal = Object.hasOwn(safeDetail, f.key) ? safeDetail[f.key] : undefined
      if (rawVal == null || rawVal === '') continue
      const formatted = typeof rawVal === 'string'
        ? formatTableField(f.key, rawVal, title || '')
        : typeof rawVal === 'number'
          ? (Number.isFinite(rawVal) ? rawVal : null)
          : typeof rawVal === 'boolean'
            ? rawVal
            : (safeString(rawVal) || null)
      if (formatted == null || formatted === '') continue
      const fieldLabel = safeString(f.label) || ownLookup(fieldLabels, f.key, f.key)
      overviewRows.push({ field: fieldLabel, value: formatted })
    }
  }

  const tables = [
    {
      sheetName: '导师概览',
      title: `${name}（${college}）档案总览`,
      description: '基础信息、评分、方向与原始公开字段汇总',
      columns: [
        { key: 'field', label: '档案项目', type: 'string' },
        { key: 'value', label: '内容', type: 'string' },
      ],
      rows: overviewRows,
    },
  ]

  const dimAndFlagRows = [
    ...fingerprintAxes.map(ax => {
      const fpAxis = isPlainObject(fingerprint[ax.key]) ? fingerprint[ax.key] : null
      const fpVal = safeNumber(fpAxis?.value)
      const fpEvidence = Array.isArray(fpAxis?.evidence) ? fpAxis.evidence.map(e => safeString(e)).filter(Boolean) : []
      return {
        category: '六维画像',
        item: ax.label,
        score_or_tone: fpVal,
        scope: '综合',
        evidence: fpEvidence.join('；') || '暂无记录',
      }
    }),
    ...flags.map(f => ({
      category: '评价标签',
      item: f.label,
      score_or_tone: f.tone === 'bad' ? '风险提示' : f.tone === 'good' ? '正面认可' : '值得留意',
      scope: f.scope || '个人',
      evidence: f.evidence.join('；'),
    })),
  ]
  if (dimAndFlagRows.length) {
    tables.push({
      sheetName: '六维画像与评价标签',
      title: `${name} 六维画像与评价依据`,
      description: '各维度分值（1–5）及对应学生/团队评价原句',
      columns: [
        { key: 'category', label: '类别', type: 'string' },
        { key: 'item', label: '维度 / 标签', type: 'string' },
        { key: 'score_or_tone', label: '分值 / 性质', type: 'unknown' },
        { key: 'scope', label: '来源范围', type: 'string' },
        { key: 'evidence', label: '评价依据', type: 'string' },
      ],
      rows: dimAndFlagRows,
    })
  }

  if (trainFacts.length || suppCards.length) {
    tables.push({
      sheetName: '培养与公开档案',
      title: `${name} 培养细节与公开学术档案`,
      description: '实习、补助、管理、毕业要求及官网科研招生资料',
      columns: [
        { key: 'section', label: '类别', type: 'string' },
        { key: 'item', label: '项目', type: 'string' },
        { key: 'content', label: '详细内容', type: 'string' },
      ],
      rows: [
        ...trainFacts.map(kv => ({ section: '培养细节', item: kv.label, content: kv.value })),
        ...suppCards.map(kv => ({ section: '公开学术', item: kv.label, content: kv.value })),
      ],
    })
  }

  return normalizeExportDocument({
    title: `${name} · 导师完整档案`,
    subtitle: `${todayShanghai()} · 北极星 Polaris · ${[college, group, title].filter(Boolean).join(' · ')}`,
    kind: 'dossier',
    summaryCards,
    sections,
    tables,
    sources: detailSources,
  })
}

const KNOWN_PUBLIC_TOOLS = new Set([
  'catalog',
  'search',
  'query',
  'join',
  'aggregate',
  'visualize',
  'get_goal',
  'complete_goal',
  'pause_goal',
])

function preGuardTextField(val) {
  if (typeof val === 'string') return preGuardPublicText(val)
  if (val == null) return val
  return preGuardPublicText(safeString(val))
}

function preGuardSourceInput(source) {
  if (!isPlainObject(source)) return source
  return {
    ...source,
    ...(source.id !== undefined ? { id: safeString(source.id) } : {}),
    ...(source.url !== undefined ? { url: typeof source.url === 'string' ? (safePublicWebUrl(source.url) || '') : undefined } : {}),
    ...(source.title !== undefined ? { title: preGuardTextField(source.title) } : {}),
    ...(source.kind !== undefined ? { kind: preGuardTextField(source.kind) } : {}),
    ...(source.scope !== undefined ? { scope: preGuardTextField(source.scope) } : {}),
    ...(source.publisher !== undefined ? { publisher: preGuardTextField(source.publisher) } : {}),
    ...(source.year !== undefined ? { year: safeNumber(source.year) ?? (safeString(source.year) || undefined) } : {}),
    ...(source.published_at !== undefined ? { published_at: safeString(source.published_at) || undefined } : {}),
    ...(source.fetched_at !== undefined ? { fetched_at: safeString(source.fetched_at) || undefined } : {}),
  }
}

function preGuardCellVal(val, seen = new WeakSet()) {
  if (val == null) return null
  if (typeof val === 'string') return preGuardPublicText(val)
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'boolean') return val
  if (typeof val === 'bigint' || typeof val === 'symbol') return String(val)
  if (Array.isArray(val)) {
    if (seen.has(val)) return null
    seen.add(val)
    return val.map(item => preGuardCellVal(item, seen))
  }
  const str = safeString(val)
  return str ? preGuardPublicText(str) : null
}

function toNullProtoRow(row) {
  const out = Object.create(null)
  for (const [k, v] of Object.entries(row)) {
    Object.defineProperty(out, k, {
      value: preGuardCellVal(v),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

function sanitizeArtifactInput(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null
  if (!Array.isArray(artifact.columns) || !Array.isArray(artifact.rows)) return null
  const columns = artifact.columns
    .filter(c => c && typeof c === 'object' && !Array.isArray(c) && typeof c.key === 'string' && c.key)
    .map(c => ({
      key: c.key,
      ...(c.label !== undefined ? { label: preGuardTextField(c.label) } : {}),
      type: typeof c.type === 'string' && c.type ? c.type : 'unknown',
      ...(typeof c.role === 'string' && c.role ? { role: c.role } : {}),
    }))
  if (!columns.length) return null
  const hasBadRows = artifact.rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))
  const rawRows = hasBadRows ? [] : artifact.rows
  const rawRowNotes = Array.isArray(artifact.row_notes) ? (hasBadRows ? [] : artifact.row_notes) : undefined
  if (hasBadRows) {
    artifact.rows.forEach((r, idx) => {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        rawRows.push(r)
        if (rawRowNotes) rawRowNotes.push(artifact.row_notes[idx])
      }
    })
  }
  const rowNotes = rawRowNotes?.map(n => preGuardTextField(n) ?? '')
  const rows = rawRows.map(toNullProtoRow)

  const purpose = typeof artifact.purpose === 'string' ? artifact.purpose : undefined
  const artType = typeof artifact.type === 'string' ? artifact.type : undefined
  const hasOrdinal = columns.some(c => c.role === 'ordinal' || /推荐序|序号|排名|名次|(?:^|_)(?:rank|position)$|序$/i.test(c.key))
  const nameCol = columns.find(c => c.key === 'name' || c.key === 'mentor_name')
  if (
    rows.length >= 2 &&
    (purpose === 'recommendation' || (!purpose && hasOrdinal)) &&
    nameCol &&
    !columns.some(c => c.key === 'student_name')
  ) {
    for (const row of rows) {
      for (const key of ['name', 'mentor_name']) {
        if (key === nameCol.key || Object.hasOwn(row, key)) {
          const val = row[key]
          if (typeof val !== 'string' || !val) {
            row[key] = typeof val === 'number' || typeof val === 'boolean' ? String(val) : (key === nameCol.key ? '—' : '')
          }
        }
      }
    }
  }

  const normalizedY = artifact.y === undefined
    ? undefined
    : (Array.isArray(artifact.y) ? artifact.y.filter(v => typeof v === 'string') : (typeof artifact.y === 'string' && artifact.y ? [artifact.y] : []))
  const normalizedSources = artifact.sources === undefined
    ? undefined
    : sanitizeObjectArray(artifact.sources).map(preGuardSourceInput)
  return {
    ...artifact,
    ...(artifact.id !== undefined ? { id: safeString(artifact.id) } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(artType !== undefined ? { type: artType } : {}),
    ...(typeof artifact.x === 'string' ? { x: artifact.x } : { x: undefined }),
    ...(typeof artifact.color_by === 'string' ? { color_by: artifact.color_by } : { color_by: undefined }),
    ...(artifact.title !== undefined ? { title: preGuardTextField(artifact.title) } : {}),
    ...(artifact.description !== undefined ? { description: preGuardTextField(artifact.description) } : {}),
    columns,
    rows,
    ...(artifact.row_notes !== undefined ? { row_notes: rowNotes } : {}),
    ...(normalizedY !== undefined ? { y: normalizedY } : {}),
    ...(normalizedSources !== undefined ? { sources: normalizedSources } : {}),
  }
}

export function buildArtifactDocument(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const { artifacts = [], title: rawTitle, subtitle: rawSubtitle } = safeOpts
  const inputList = Array.isArray(artifacts) ? artifacts : [artifacts]
  const cleanArtifacts = inputList
    .map(sanitizeArtifactInput)
    .filter(Boolean)
    .map(a => publicArtifact({ ...a, type: 'table' }))
    .filter(Boolean)

  if (!cleanArtifacts.length) {
    throw new Error('没有可导出的有效数据表')
  }

  const docTitle = safeString(rawTitle) || (cleanArtifacts.length === 1 ? (safeString(cleanArtifacts[0].title) || '北极星推荐与分析数据表') : '北极星推荐与分析数据表')
  const subtitle = safeString(rawSubtitle)
  const totalRows = cleanArtifacts.reduce((sum, a) => sum + (a.rows?.length || 0), 0)
  const sources = dedupeSources(cleanArtifacts.flatMap(a => a.sources || []))

  const tables = cleanArtifacts.map(a => ({
    sheetName: safeString(a.title) || '数据表',
    title: safeString(a.title) || docTitle,
    description: safeString(a.description) || `共 ${a.rows?.length || 0} 条记录`,
    columns: a.columns,
    rows: a.rows,
  }))

  const sections = cleanArtifacts
    .filter(a => safeString(a.description))
    .map(a => ({
      heading: safeString(a.title) || '数据说明',
      level: 3,
      paragraphs: [safeString(a.description)],
    }))

  return normalizeExportDocument({
    title: docTitle,
    subtitle: subtitle || `${todayShanghai()} · 北极星 Polaris · 共 ${cleanArtifacts.length} 张表 · ${totalRows} 条记录`,
    kind: 'table',
    summaryCards: [
      { label: '数据表数', value: `${cleanArtifacts.length} 张` },
      { label: '总记录数', value: `${totalRows} 条` },
      { label: '参考来源', value: `${sources.length} 项` },
    ],
    sections,
    tables,
    sources,
  })
}

function markdownBlocksToSectionsAndTables(markdown, baseTitle = '分析内容') {
  const blocks = parseMarkdownBlocks(markdown)
  const sections = []
  const tables = []
  let current = null

  const ensureSection = (heading = baseTitle, level = 2) => {
    if (!current) {
      current = { heading, level, paragraphs: [], bullets: [], quote: null, tables: [] }
      sections.push(current)
    }
    return current
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      current = {
        heading: block.text,
        level: block.level >= 3 ? 3 : 2,
        paragraphs: [],
        bullets: [],
        quote: null,
        tables: [],
      }
      sections.push(current)
    } else if (block.type === 'paragraph') {
      ensureSection().paragraphs.push(block.text)
    } else if (block.type === 'list') {
      ensureSection().bullets.push(...block.items)
    } else if (block.type === 'quote') {
      const sec = ensureSection()
      sec.quote = sec.quote ? `${sec.quote}\n${block.text}` : block.text
    } else if (block.type === 'code') {
      ensureSection().paragraphs.push(block.text)
    } else if (block.type === 'table') {
      const sec = ensureSection()
      const cols = block.headers.map((h, i) => ({
        key: `col_${i}`,
        label: h || `列${i + 1}`,
        type: 'unknown',
      }))
      const rows = block.rows.map(cells => {
        const obj = {}
        cols.forEach((col, idx) => {
          const raw = cells[idx] ?? ''
          const num = Number(raw)
          obj[col.key] = raw !== '' && !Number.isNaN(num) && /^-?\d+(?:\.\d+)?$/.test(raw.trim()) ? num : raw
        })
        return obj
      })
      const tableObj = {
        sheetName: sec.heading || `附表 ${tables.length + 1}`,
        title: sec.heading || `正文数据表 ${tables.length + 1}`,
        description: `提取自正文 Markdown 表格（共 ${rows.length} 行）`,
        columns: cols,
        rows,
      }
      tables.push(tableObj)
      sec.tables.push(tableObj)
    }
  }

  return { sections, tables }
}

export function buildChatDocument(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const { chat, messageId = null, title: rawTitle } = safeOpts
  if (!isPlainObject(chat) || !Array.isArray(chat.messages)) {
    throw new Error('缺少对话记录')
  }
  const sanitizedMessages = chat.messages
    .filter(isPlainObject)
    .map(m => ({
      ...m,
      ...(m.id !== undefined ? { id: safeString(m.id) } : {}),
      role: typeof m.role === 'string' ? m.role : safeString(m.role),
      ...(m.status !== undefined ? { status: typeof m.status === 'string' ? m.status : safeString(m.status) } : {}),
      artifactsPending: Boolean(m.artifactsPending),
      ...(m.content !== undefined ? { content: preGuardTextField(m.content) ?? '' } : {}),
      ...(m.progress !== undefined ? { progress: preGuardTextField(m.progress) ?? '' } : {}),
      ...(m.error !== undefined ? { error: preGuardTextField(m.error) ?? '' } : {}),
      ...(m.artifacts !== undefined
        ? {
            artifacts: Array.isArray(m.artifacts)
              ? m.artifacts.map(sanitizeArtifactInput).filter(Boolean)
              : [],
          }
        : {}),
      ...(m.sources !== undefined ? { sources: sanitizeObjectArray(m.sources).map(preGuardSourceInput) } : {}),
      ...(m.tools !== undefined
        ? {
            tools: sanitizeObjectArray(m.tools).map(t => {
              const labelText = typeof t.label === 'string' ? t.label : (t.label != null ? safeString(t.label) : '')
              return {
                ...t,
                ...(t.id !== undefined ? { id: safeString(t.id) } : {}),
                ...(t.status !== undefined ? { status: safeString(t.status) } : {}),
                label: labelText
                  ? preGuardPublicText(labelText)
                  : (typeof t.name === 'string' && KNOWN_PUBLIC_TOOLS.has(t.name) ? undefined : '查询资料'),
                ...(t.summary !== undefined ? { summary: preGuardTextField(t.summary) ?? '' } : {}),
              }
            }),
          }
        : {}),
      ...(m.activity !== undefined
        ? {
            activity: sanitizeObjectArray(m.activity).map(a => ({
              ...a,
              ...(a.id !== undefined ? { id: safeString(a.id) } : {}),
              ...(a.label !== undefined ? { label: preGuardTextField(a.label) ?? '' } : {}),
              ...(a.count !== undefined ? { count: safeNumber(a.count) } : {}),
            })),
          }
        : {}),
      ...(m.files !== undefined
        ? {
            files: sanitizeObjectArray(m.files).map(f => ({
              id: f.id != null ? safeString(f.id) : undefined,
              name: safeString(f.name),
              format: safeString(f.format),
              depth: safeNumber(f.depth),
              count: safeNumber(f.count),
              createdAt: safeString(f.createdAt),
            })),
          }
        : {}),
    }))
  const safeAll = publicMessages(sanitizedMessages)
  let selected = safeAll
  if (messageId) {
    const idx = safeAll.findIndex(m => m.id === messageId)
    if (idx < 0) throw new Error('未找到指定的回复消息')
    const target = safeAll[idx]
    const prevUser = idx > 0 && safeAll[idx - 1]?.role === 'user' ? safeAll[idx - 1] : null
    selected = prevUser ? [prevUser, target] : [target]
  } else {
    selected = safeAll.filter(m => m.role === 'user' || m.status === 'complete' || m.content || m.artifacts?.length)
  }

  const docTitle = safeString(rawTitle) || safeString(chat.title) || (messageId ? '北极星单条回复导出' : '北极星对话记录')
  const sections = []
  const tables = []
  const summaryRows = []
  const allSources = []

  selected.forEach((msg, idx) => {
    const roleLabel = msg.role === 'user' ? '我的提问' : '北极星 Polaris 回答'
    const createdRaw = typeof msg.createdAt === 'string' || typeof msg.createdAt === 'number' || msg.createdAt instanceof Date
      ? msg.createdAt
      : null
    const createdDate = createdRaw != null ? new Date(createdRaw) : null
    const timeLabel = createdDate && !Number.isNaN(createdDate.getTime())
      ? createdDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : ''
    const cleanContent = sanitizeText(msg.content || '')
    const artifacts = (msg.artifacts || [])
      .filter(a => a && Array.isArray(a.columns) && a.columns.length > 0 && Array.isArray(a.rows))
      .map(a => publicArtifact({ ...a, type: 'table' }))
      .filter(Boolean)

    if (msg.sources?.length) allSources.push(...msg.sources)
    const artifactTables = []
    for (const a of artifacts) {
      if (a.sources?.length) allSources.push(...a.sources)
      const aTitle = safeString(a.title)
      const aDesc = safeString(a.description)
      const artTitle = aTitle || `附带数据表 ${tables.length + 1}`
      const tableObj = {
        sheetName: aTitle || `数据表 ${tables.length + 1}`,
        title: artTitle,
        description: aDesc,
        columns: a.columns,
        rows: a.rows,
      }
      tables.push(tableObj)
      artifactTables.push({ artifact: a, tableObj, artTitle, aDesc })
    }

    summaryRows.push({
      turn: idx + 1,
      role: roleLabel,
      time: timeLabel || '—',
      content: cleanContent || (artifacts.length ? `生成 ${artifacts.length} 张数据表` : '—'),
      artifact_count: artifacts.length,
    })

    if (msg.role === 'user') {
      sections.push({
        heading: `提问 #${Math.floor(idx / 2) + 1}`,
        level: 2,
        callout: { title: timeLabel ? `提问 · ${timeLabel}` : '提问', text: cleanContent, tone: 'note' },
      })
    } else {
      const parsed = markdownBlocksToSectionsAndTables(cleanContent, '回答正文')
      if (parsed.sections.length) {
        sections.push({
          heading: timeLabel ? `${roleLabel}（${timeLabel}）` : roleLabel,
          level: 2,
          paragraphs: [],
          bullets: [],
        })
        for (const sub of parsed.sections) {
          sections.push({ ...sub, level: 3 })
        }
        for (const t of parsed.tables) tables.push(t)
      } else if (cleanContent) {
        sections.push({
          heading: roleLabel,
          level: 2,
          paragraphs: [cleanContent],
        })
      }
      for (const { tableObj, artTitle, aDesc } of artifactTables) {
        sections.push({
          heading: artTitle,
          level: 3,
          paragraphs: aDesc ? [aDesc] : [],
          tables: [tableObj],
        })
      }
    }
  })

  const orderedTables = [
    {
      sheetName: '对话摘要',
      title: `${docTitle} · 对话内容摘要`,
      description: `共 ${selected.length} 条消息`,
      columns: [
        { key: 'turn', label: '序号', type: 'number' },
        { key: 'role', label: '角色', type: 'string' },
        { key: 'time', label: '时间', type: 'string' },
        { key: 'content', label: '消息内容', type: 'string' },
        { key: 'artifact_count', label: '附带表数', type: 'number' },
      ],
      rows: summaryRows,
    },
    ...tables,
  ]

  const sources = dedupeSources(allSources)

  return normalizeExportDocument({
    title: docTitle,
    subtitle: `${todayShanghai()} · 北极星 Polaris · ${selected.length} 条对话记录`,
    kind: 'chat',
    summaryCards: [
      { label: '消息条数', value: `${selected.length} 条` },
      { label: '附带数据表', value: `${tables.length} 张` },
      { label: '参考来源', value: `${sources.length} 项` },
    ],
    sections,
    tables: orderedTables,
    sources,
  })
}

export function buildCustomDocument(options = {}) {
  const safeOpts = isPlainObject(options) ? options : {}
  const {
    title: rawTitle = '北极星 Polaris 专题报告',
    content = '',
    tables = [],
    sources = [],
    subtitle: rawSubtitle,
    summaryCards = [],
    filtersApplied = [],
  } = safeOpts
  const title = safeString(rawTitle) || '北极星 Polaris 专题报告'
  const subtitle = safeString(rawSubtitle)
  const safeContent = sanitizeText(safeString(content))
  const parsed = markdownBlocksToSectionsAndTables(safeContent, title)
  const tableInput = Array.isArray(tables)
    ? tables
    : (isPlainObject(tables) ? [tables] : [])
  const normalizedPassedTables = tableInput
    .filter(isPlainObject)
    .map(t => {
      if (Array.isArray(t.columns) && t.columns.length > 0) {
        return Array.isArray(t.rows) ? { ...t, rows: sanitizeObjectArray(t.rows) } : { ...t, rows: [] }
      }
      if (!Array.isArray(t.rows) || !t.rows.length) return null
      const cleanRows = sanitizeObjectArray(t.rows)
      if (!cleanRows.length) return null
      const keys = [...new Set(cleanRows.flatMap(r => Object.keys(r)))]
        .filter(k => k && !isInternalField(k))
      if (!keys.length) return null
      const inferredColumns = keys.map(key => ({
        key,
        label: ownLookup(fieldLabels, key, key),
        type: cleanRows.every(r => !r || !Object.hasOwn(r, key) || r[key] == null || (typeof r[key] === 'number' && Number.isFinite(r[key]))) ? 'number' : 'string',
      }))
      return { ...t, columns: inferredColumns, rows: cleanRows }
    })
    .filter(Boolean)

  const combinedTables = [...normalizedPassedTables, ...parsed.tables]
  const deduped = dedupeSources([
    ...sanitizeObjectArray(sources),
    ...normalizedPassedTables.flatMap(t => sanitizeObjectArray(t.sources)),
  ])

  const safeSummaryCards = Array.isArray(summaryCards) ? summaryCards.filter(isPlainObject) : []
  const safeFilters = Array.isArray(filtersApplied) ? filtersApplied : []
  const cards = safeSummaryCards.length
    ? safeSummaryCards
    : [
        { label: '章节数量', value: `${parsed.sections.length || 1} 节` },
        { label: '附带表格', value: `${combinedTables.length} 张` },
        { label: '参考来源', value: `${deduped.length} 项` },
      ]

  return normalizeExportDocument({
    title,
    subtitle: subtitle || `${todayShanghai()} · 北极星 Polaris`,
    kind: 'document',
    summaryCards: cards,
    filtersApplied: safeFilters,
    sections: parsed.sections,
    tables: combinedTables,
    sources: deduped,
  })
}

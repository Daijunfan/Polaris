import { fieldLabels } from './data.js'
import Ajv from 'ajv'
import { randomUUID } from 'node:crypto'
import { internalColumn,ordinalColumn } from './presentation.js'
import {createMentorIndex,homophoneMatches} from './search.js'
import {cleanDefensiveText} from './answer-policy.js'

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = description => ({ type: 'string', description })
const strings = description => ({ type: 'array', items: { type: 'string' }, description })
const datasets=['mentors','students','exams','reviews','profiles','sources']
export const filtersSchema = { type: 'array', description: 'AND 筛选；范围可用 between: [下限,上限]，多选用 in。数值比较不会把 null 当作 0。', items: object({
  field: str('字段名；先用 catalog 查看字段'),
  op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'contains', 'not_contains', 'is_null', 'not_null'] },
  value: { description: '按字段类型提供值；between 和 in 使用数组；is_null / not_null 可省略', anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } }, { type: 'null' }] },
}, ['field', 'op']) }
const from = str('数据集名 mentors / students / exams / reviews / profiles / sources，或此前结果的 ref。mentors已按稳定身份关联评价、评分、公开研究与指导资料及博士资格，research_evidence汇集科研培养与项目平台要点，profile_evidence/training_evidence/doctoral_evidence可直接组合；profiles保留逐页公开介绍，按mentor_id关联，source_type和url保留出处。ref只包含实际返回的行；不要把分页样本当成全部。')
const sorting = { sort_by: str('单字段排序；多字段请用 sort'), order: { type: 'string', enum: ['asc', 'desc'], description: '默认 desc；null 始终排在末尾' }, sort:{type:'array',description:'只排序，不筛选。values指定字段值的先后顺序，未列出的行仍保留。只选指定名单时须同时用filters的in，或直接visualize的pick；pick同时筛选并排序。',minItems:1,items:object({field:str('排序字段'),order:{type:'string',enum:['asc','desc']},values:{type:'array',minItems:1,items:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},description:'按此顺序排列，默认asc；未列出的值置后'}},['field'])} }
const derivation={type:'array',description:'仅计算数值新列，不用于文本复制或字段改名。界面自动显示中文列名，select已有字段即可。先逐行计算新列，再筛选、排序和选列。expr为数值、字段名，或前缀表达式数组： ["abs",["-","score_first",350]]。支持 + - * / abs sqrt round min max coalesce；可引用前面生成的新列。null参与计算仍为null，除以0也为null。',items:object({as:str('新列中文名称，不能覆盖已有列'),expr:{anyOf:[{type:'number'},{type:'string'},{type:'array',minItems:2,items:{}}]}},['as','expr'])}
const paging = { limit: { type: 'integer', minimum: 1, maximum: 5000, description: '默认 30，最多 5000；完整统计优先 aggregate 原始数据集' }, offset: { type: 'integer', minimum: 0 } }

export const toolDefinitions = [
  { name: 'catalog', description: '发现数据范围、来源、字段、数据年份和局限。开始数据问题时调用，禁止假设其他学院或当前招生情况。', parameters: object({ dataset: { type: 'string', enum: datasets } }) },
  { name:'search',description:'跨来源召回研究主题与培养路线相关导师，同时搜索个人资料、官网、团队方向与职责。支持AI security、大模型安全等同义表达，横向/纵向还召回工程训练、学术偏好、项目与经费资源等相关表述；matched_topics显示实际命中原词，training_evidence保留个人培养、组内项目平台与官网项目记录，不因未命中主题词而丢失，资源和培养偏好按实际内容介绍，项目资助类别采用明确记载。个人字段为空不会提前排除。can_supervise_doctoral由导师类别或博士指导学科得到，group_lead来自明确管理分工。默认保留完整结果，模型预览列出本页全部候选，详情用query该ref选择topic_evidence等字段；ref可继续筛选、关联、统计和作图。读博、深造与学术训练按研究培养相关条件召回，评分、公开研究与指导资料和培养记录同时返回；相关顺序不等于学术评分。',parameters:object({terms:{type:'array',items:{type:'string',minLength:1},minItems:1,description:'使用用户最具体的研究主题原词，工具会展开中英文同义词。例：大模型安全只传["大模型安全"]，不可另加更宽的“大模型”或“AI安全”并用any混入相邻方向。只有用户明确接受多个方向时才给多项，例如["横向","纵向"]'},mode:{type:'string',enum:['any','all'],description:'关键词之间默认any（或），all要求各主题都命中；方向扩展同义表达，培养路线扩展相关资源和训练表述'},filters:filtersSchema,select:strings('默认保留所有字段；可选择topic_evidence及导师原字段'),...sorting,...paging},['terms'])},
  { name: 'query', description: '计算、筛选、排序、选列、分页。排名可用sort:[{field:"mentor_id",values:[按推荐顺序的ID]}]保留选择顺序，再用row_number_as:"推荐序"自动编号。derive支持分差等数值表达式。导师人数与分数汇总为全专业，限定专业应筛exams后统计。', parameters: object({ from, derive:derivation, filters: filtersSchema, row_number_as:str('排序后、分页前从1自动编号的新列名，例如推荐序；生成列自动加入输出，不会被本次select遗漏'),select: strings('选择当前from或新计算的字段。省略使用默认列；详情可选review_text、mentor_note等'), ...sorting, ...paging }, ['from']) },
  { name: 'join', description: '按等值键连接两个数据集或查询 ref。可将筛出的考生与导师、评价关联。右表重名列加 right_ 前缀；空键永不匹配。', parameters: object({ left: from, right: from, left_on: str('左表关联字段'), right_on: str('右表关联字段'), how: { type: 'string', enum: ['inner', 'left'] }, select: strings('连接后的字段'), ...paging }, ['left', 'right', 'left_on', 'right_on']) },
  { name: 'aggregate', description: '对完整数据集或 ref 做分组统计：计数、均值、中位数、范围、分位数、标准差、皮尔逊相关系数、直方图分桶及values值列表。values按原顺序保留所有非空值和重复值，用于列出每位导师的实际样本分数，直接传给比较表，不手抄数组。数值统计忽略 null；correlation 使用 field 与 with 同时为数值的配对样本。样本数必须一起报告。不要在分页 query 后错误计算全体统计。', parameters: object({
    from, filters: filtersSchema, group_by: strings('分组字段；省略统计全体'),
    metrics: { type: 'array', items: object({ op: { type: 'string', enum: ['count', 'mean', 'median', 'min', 'max', 'sum', 'quantile', 'stddev', 'correlation','values'] }, field: str('count 可省略；values可收集任意字段，其余需要数值字段'), with: str('correlation 必填：另一个数值字段'), as: str('输出列名，例如 样本数、初试均分'), q: { type: 'number', minimum: 0, maximum: 1, description: 'quantile 的分位点' } }, ['op', 'as']) },
    bucket: object({ field: str('数值字段'), width: { type: 'number', exclusiveMinimum: 0 } }, ['field', 'width']), ...sorting, ...paging,
  }, ['from', 'metrics']) },
  { name: 'visualize', description: '交付真实图表或名单。核对资料使用query，最终展示使用visualize。pick指定有序姓名或ID、row_number_as自动编号、select选业务列；replace更新已有图表，discard移除多余图表并保留数据ref。所有行来自真实记录。', parameters: {...object({
    discard:str('移除本轮多余图表的id；仅传discard即可，查询ref继续保留。'),
    from: str('已有结果ref；type为table时也可直接使用mentors等原数据集。'), type: { type: 'string', enum: ['bar', 'line', 'scatter', 'table', 'metric'] }, title: str('中文短标题，准确对应实际范围'),
    purpose:{type:'string',enum:['recommendation','comparison','statistics'],description:'展示用途：推荐名单用recommendation；条件对照用comparison；样本数、分布等统计用statistics。统计的排序不代表导师推荐名次。'},
    row_notes:{description:'按唯一字段关联逐行说明，排序后仍属于对应记录。优先用{by:"name",entries:[{value:"导师姓名",text:"适合点"}]}；by字段须保留在select中，同名时用mentor_id等唯一字段。replace时可只提供变动行说明，其余相同记录的说明保留；新图可省略说明。只写本题相关的已有事实。旧字符串数组按最终行顺序保留兼容。',anyOf:[object({by:str('当前视图中能唯一定位记录的字段'),entries:{type:'array',items:object({value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},text:{type:'string',maxLength:160}},['value','text'])}},['by','entries']),{type:'array',items:{type:'string',maxLength:160}}]},
    pick: object({field:str('唯一定位记录的字段，如name或mentor_id；同名时用mentor_id。'),values:{type:'array',items:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},description:'按展示顺序列出要选的真实字段值，不能传自编记录。'}},['field','values']),
    row_number_as:str('可选：自动编号的新列名，如推荐序；自动保留在输出中。'),
    replace: str('可选：要更新的现有图表id，来自此前artifact.id。只替换这张图，其余图表保留。修正分类名单时使用，不重复创建。'),
    x: str('分类字段；数值分桶柱状图/折线/散点为横轴，文字分类柱状图横向排列便于阅读；table和metric可省略'), y: strings('数值字段，一到四个系列；metric为每张指标卡的数值，table可省略'),
    color_by: str('散点图的颜色字段，如 admitted / program；分类生成图例，数值使用连续色阶。字段需已包含在查询结果中。'),
    description: str('只写年份、专业、单位和实际数据范围；数量由表内指标展示。'), select: strings('选择与问题相关的业务列，保留用户所问维度。具名选人时可从同一批已存记录补齐省略的导师静态字段，不改变所选人。指导和项目资源从search结果ref选择training_evidence、topic_evidence；静态条件可选name/management/internship等。省略会排除内部ID列。'),
  }),anyOf:[{required:['discard']},{required:['from','type','title']}]} },
].map(fn => ({ type: 'function', function: fn }))

const ajv = new Ajv({ strict: false })
const validators = new Map(toolDefinitions.map(tool => [tool.function.name, ajv.compile(tool.function.parameters)]))

const defaults = {
  mentors: ['mentor_id', 'name', 'college', 'group', 'personal_directions', 'academic_summary', 'enrollment_signal', 'mentor_note', 'rating', 'green_flags', 'red_flags', 'watch_flags', 'actual_supervisor', 'management', 'internship', 'graduation', 'can_supervise_doctoral', 'doctoral_evidence', 'group_lead', 'stipend_monthly_min', 'stipend_monthly_max', 'stipend_text', 'student_count', 'exam_count', 'recommended_count', 'research_evidence', 'profile_evidence', 'training_evidence'],
  students: ['student_name','student_id', 'mentor_id', 'mentor_name', 'program', 'admission_type', 'match_status', 'score_first', 'score_reexam', 'score_total', 'rank_first', 'rank_first_program'],
  profiles:['name','college','professional_title','research_areas','contact_email','source_type','url','fetched_at'],
}
const unique = array => [...new Set(array)]
const round = n => n == null ? null : Math.round(n * 1000) / 1000
const numeric = values => values.filter(v => typeof v === 'number' && Number.isFinite(v))
function quantile(values, q) {
  if (!values.length) return null
  const sorted = values.toSorted((a, b) => a - b), index = (sorted.length - 1) * q, low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}
function columnsFor(rows, keys = unique(rows.flatMap(row => Object.keys(row)))) {
  return keys.map(key => ({ key, label: fieldLabels[key] || key, type: rows.map(row => row[key]).find(v => v != null) == null ? 'unknown' : typeof rows.find(row => row[key] != null)[key] }))
}
function assertField(columns, field) {
  if (!columns.some(c => c.key === field)) throw new Error(`未知字段 ${field}。可用字段：${columns.map(c => c.key).join(', ')}`)
}
function filterRows(table, filters = []) {
  if (!Array.isArray(filters)) throw new Error('filters 必须是数组')
  for (const f of filters) {
    assertField(table.columns, f.field)
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'contains', 'not_contains', 'is_null', 'not_null'].includes(f.op)) throw new Error(`未知筛选操作 ${f.op}`)
    if (['in', 'not_in'].includes(f.op) && !Array.isArray(f.value)) throw new Error(`${f.op} 需要数组`)
    if (f.op === 'between' && (!Array.isArray(f.value) || f.value.length !== 2)) throw new Error('between 需要 [下限,上限]')
    if (!['is_null', 'not_null'].includes(f.op) && f.value === undefined) throw new Error(`${f.op} 需要 value`)
  }
  const splitCollege = s => String(s).split(/[、,，]+/).map(p => p.replace(/[（(].*$/, '').trim()).filter(Boolean)
  const normCol = s => String(s).replace(/[（(].*$/, '').trim()
  return table.rows.filter(row => filters.every(f => {
    const value = row[f.field], target = f.value
    if (f.op === 'is_null') return value == null
    if (f.op === 'not_null') return value != null
    if (f.op === 'eq') return value === target || (f.field === 'college' && typeof value === 'string' && target != null && splitCollege(value).includes(normCol(target)))
    if (f.op === 'ne') return value !== target && !(f.field === 'college' && typeof value === 'string' && target != null && splitCollege(value).includes(normCol(target)))
    if (value == null) return false
    if (f.op === 'in') return target.includes(value) || (f.field === 'college' && typeof value === 'string' && splitCollege(value).some(part => target.some(t => normCol(t) === part)))
    if (f.op === 'not_in') return !target.includes(value) && !(f.field === 'college' && typeof value === 'string' && splitCollege(value).some(part => target.some(t => normCol(t) === part)))
    if (f.op === 'between') return value >= target[0] && value <= target[1]
    if (f.op === 'contains' || f.op === 'not_contains') {
      const found = Array.isArray(value) ? value.includes(target) : String(value).toLocaleLowerCase().includes(String(target).toLocaleLowerCase())
      return f.op === 'contains' ? found : !found
    }
    if (typeof value !== typeof target) throw new Error(`${f.field} 与筛选值类型不一致`)
    if (f.op === 'gt') return value > target
    if (f.op === 'gte') return value >= target
    if (f.op === 'lt') return value < target
    if (f.op === 'lte') return value <= target
  }))
}
function sorted(rows, columns, args) {
  const order=args.sort||(args.sort_by?[{field:args.sort_by,order:args.order}]:[])
  if(!order.length)return rows
  order.forEach(item=>assertField(columns,item.field))
  const rules=order.map(item=>({...item,positions:item.values?new Map(item.values.map((value,index)=>[value,index])):null}))
  return rows.toSorted((a, b) => {
    for(const item of rules) {
      const x=a[item.field],y=b[item.field]
      if(x==null&&y==null)continue
      if(x==null)return 1
      if(y==null)return -1
      if(item.positions){
        const knownX=item.positions.has(x),knownY=item.positions.has(y)
        if(!knownX||!knownY){if(knownX!==knownY)return knownX?-1:1;continue}
      }
      const cmp=item.positions?(item.positions.get(x)??Infinity)-(item.positions.get(y)??Infinity):typeof x==='number'?x-y:String(x).localeCompare(String(y),'zh-CN',{numeric:true})
      if(cmp)return item.positions?(item.order==='desc'?-cmp:cmp):item.order==='asc'?cmp:-cmp
    }
    return 0
  })
}
const operators={
  '+':values=>values.reduce((a,b)=>a+b), '-':values=>values.length===1?-values[0]:values[0]-values[1], '*':values=>values.reduce((a,b)=>a*b), '/':values=>values[1]===0?null:values[0]/values[1],
  abs:values=>Math.abs(values[0]), sqrt:values=>Math.sqrt(values[0]), round:values=>Math.round(values[0]*10**(values[1]||0))/10**(values[1]||0), min:values=>Math.min(...values), max:values=>Math.max(...values),
}
function expression(expr,columns) {
  if(typeof expr==='number')return {read:()=>expr,fields:[]}
  if(typeof expr==='string') {assertField(columns,expr);return {read:row=>{const value=row[expr];if(value!=null&&typeof value!=='number')throw new Error(`${expr} 不是数值字段`);return value??null},fields:[expr]}}
  if(!Array.isArray(expr)||!expr.length)throw new Error('算式需要数值、字段名或前缀表达式数组')
  const [op,...args]=expr
  if(op!=='coalesce'&&!Object.hasOwn(operators,op))throw new Error(`不支持的算式运算 ${op}`)
  const valid=['abs','sqrt'].includes(op)?args.length===1:op==='round'||op==='-'?args.length>=1&&args.length<=2:op==='/'?args.length===2:args.length>=2
  if(!valid)throw new Error(`${op} 的算式参数数量不正确`)
  const children=args.map(arg=>expression(arg,columns))
  return {fields:unique(children.flatMap(child=>child.fields)),read:row=>{
    const values=children.map(child=>child.read(row))
    if(op==='coalesce')return values.find(value=>value!=null)??null
    if(values.some(value=>value==null))return null
    const value=operators[op](values)
    return Number.isFinite(value)?value:null
  }}
}
function derived(table,definitions=[]) {
  let {rows,columns}=table
  for(const definition of definitions) {
    if(columns.some(column=>column.key===definition.as))throw new Error(`计算列不能覆盖已有字段 ${definition.as}`)
    const expr=expression(definition.expr,columns),scope=expr.fields.some(field=>columns.find(column=>column.key===field).statistic_scope==='all_programs')?'all_programs':undefined
    const statistic=expr.fields.length>0&&expr.fields.every(field=>columns.find(column=>column.key===field).role==='statistic')
    rows=rows.map(row=>({...row,[definition.as]:expr.read(row)}))
    columns=[...columns,{key:definition.as,label:definition.as,type:'number',...(scope?{statistic_scope:scope}:{}),...(statistic?{role:'statistic'}:{})}]
  }
  return {...table,rows,columns}
}
function selected(rows, columns, select) {
  if (!select) return { rows, columns }
  if (!Array.isArray(select) || !select.length) throw new Error('select 必须是非空字段数组')
  select.forEach(field => assertField(columns, field))
  return { rows: rows.map(row => Object.fromEntries(select.map(field => [field, row[field] ?? null]))), columns: select.map(key => columns.find(c => c.key === key)) }
}
function titleCount(title) {
  const match = title.match(/(最多|至多|不超过|前)?(?<![\d零一二三四五六七八九十百千万两])([\d零一二三四五六七八九十百千两]+)\s*(?:位|名(?![册额单次称字校]))(导师|老师|候选|学生|考生|同学)?/)
  if (!match) return null
  const value = match[2], digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }, units = { 十: 10, 百: 100, 千: 1000 }
  let count = Number(value)
  if (!Number.isFinite(count)) {
    count = 0; let digit = 0
    for (const char of value) {
      if (char in digits) digit = digits[char]
      else if (char in units) { count += (digit || 1) * units[char]; digit = 0 }
      else return null
    }
    count += digit
  }
  const entity = match[3] || title.slice(match.index + match[0].length, match.index + match[0].length + 12).match(/导师|老师|候选|学生|考生|同学/)?.[0]
  return { count, maximum: Boolean(match[1]), students: ['学生', '考生', '同学'].includes(entity) }
}

export function createToolRuntime(data, savedTables = {}) {
  const tables = { ...savedTables }
  let nextId = Math.max(0, ...Object.keys(tables).map(key => Number(key.replace('t', '')) || 0)) + 1
  const sourceObjects = ids => data.sources.filter(s => ids.includes(s.id))
  let mentorIndex
  const index=()=>mentorIndex||=createMentorIndex(data)
  function resolve(name) {
    if (tables[name]) return tables[name]
    if (!datasets.includes(name)) throw new Error(`找不到数据集或结果 ${name}；先调用 catalog，或使用当前会话的 ref`)
    const rows = name==='mentors'?index().rows.filter(row=>data.mentors.some(mentor=>mentor.mentor_id===row.mentor_id)):data[name]||[]
    const columns = columnsFor(rows).map(column => name === 'mentors' && (/^score_first_/.test(column.key) || ['student_count', 'exam_count', 'recommended_count', 'exam_ratio', 'recommended_ratio'].includes(column.key)) ? {
      ...column,
      label: /^score_first_/.test(column.key) ? `${column.label}（全专业）` : column.label,
      description: '覆盖该导师全部专业的名册或唯一关联成绩。限定专业、分数段或拟录取状态时，应筛选 students/exams 后重新统计，不能直接使用此汇总值。',
      statistic_scope: 'all_programs',
    } : /^stipend_monthly_(min|max)$/.test(column.key)?{...column,description:'用于筛选和排序的月劳务记录金额或区间端点；年级、支付条件及奖金读取stipend_text。'}:column.key==='academic_summary'?{...column,description:'从公开履历、项目成果与培养资料提取的职称、团队管理职责、代表性科研项目/论文与培养定位概览，不含主观评分。'}:column.key==='enrollment_signal'?{...column,description:'从2026全专业名册与唯一关联初复试成绩提取的学生实际选择与高分生源信号（名册人数、保研/考研构成、全院初试高分或第1名等），用于与科研实力和口碑交叉印证。'}:column.key==='group_context'?{...column,description:'团队分工与培养资料；含多个子团队时，按明示的主体分别读取，不把某一分支的安排当成全组统一制度。个人查询以已记载的management、internship、graduation及mentor_note为准，不追加与个人安排不同的组管理条件；单独问组整体时按该组完整评价回答。null表示此人按个人安排培养。'}:column.key==='rating'?{...column,description:'原评价的培养体验评分，反映指导、相处与培养安排；不是学术成果评分。科研适配结合research_evidence和profile_evidence中的实际指导、项目平台及成果比较。'}:column.key==='research_evidence'?{...column,description:'从个人评价、适用团队资料和公开介绍中提取科研培养、项目平台与研究成果相关要点，不生成学术分数或推荐名次；各句的主体和条件保持准确。'}:['green_flags','red_flags','watch_flags'].includes(column.key)?{...column,description:'评价要点归纳的标签，细节以完整评价记录为准'}:column.key==='actual_supervisor'?{...column,description:'评价写明的日常带教导师'}:column.key==='can_supervise_doctoral'?{...column,description:'来自导师类别或明确博士指导学科；博士学历本身不是指导资格。硕士阶段为以后读博做准备时，不要求此字段为true。'}:column.key==='research_areas'?{...column,description:'网页正向列举的研究领域，不是排他清单；顺序不表示主次。综合个人记录与适用团队方向判断匹配，不能因网页未列某词就判定不做或不是主要方向。'}:['program','program_code'].includes(column.key)?{...column,description:column.key==='program'?'专业中文名称；六位专业代码在exams.program_code，先按代码查名称后也可用于students.program。':'六位专业代码字符串，按代码筛选使用此字段。',examples:[...new Set(rows.map(row=>row[column.key]).filter(Boolean))].slice(0,4)}:column)
    return { rows, columns, row_source_ids:rows.map(row=>name==='sources'?[row.id]:row.source_ids||[]), source_ids: name === 'sources' ? rows.map(s => s.id) : unique(rows.flatMap(r => r.source_ids ?? [])) }
  }
  function save(table, args = {}) {
    const limit = args.limit ?? 30, offset = args.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(offset) || offset < 0) throw new Error('limit 必须是 1–5000 的整数，offset 必须是非负整数')
    const rows = table.rows.slice(offset, offset + limit), ref = `t${nextId++}`
    const rowSources=table.row_source_ids?.slice(offset,offset+limit),sourceIds=rowSources?unique(rowSources.flat()):table.source_ids
    const {view,...stored}=table
    tables[ref] = { ...stored, rows, source_ids:sourceIds, ...(rowSources?{row_source_ids:rowSources}:{}) }
    return { ref, rows, columns: table.columns, ...(rowSources?{row_source_ids:rowSources}:{}), total: table.rows.length, returned: rows.length, offset, next_offset: offset + rows.length < table.rows.length ? offset + rows.length : null, sources: sourceObjects(sourceIds), notes: ['ref 仅包含本次返回的行；全体统计请对原数据集 aggregate，或查询足够大的 limit。', '用户要求展示完整名单时，将完整结果 ref 直接交给 visualize；再次筛选人数或占比会缩小展示范围。'] }
  }
  function acceptInput(input) {
    if (!Array.isArray(input.rows)) throw new Error('标准输入需要含 rows 数组的 JSON 结果')
    if (input.total > input.rows.length) throw new Error('管道输入是分页样本；请增大上游 limit，避免把样本当作全部')
    const ref = `t${nextId++}`
    tables[ref] = { rows: input.rows, columns: input.columns || columnsFor(input.rows), row_source_ids:input.row_source_ids, source_ids: input.sources?.map(s => s.id) ?? [] }
    return ref
  }
  function execute(name, args = {}) {
    const validate = validators.get(name)
    if (!validate) throw new Error(`未知工具 ${name}`)
    if (!validate(args)) {
      const error = validate.errors.find(error=>error.keyword!=='anyOf'&&!(name==='visualize'&&args.discard===undefined&&error.params.missingProperty==='discard'))||validate.errors[0]
      const extra=name==='visualize'&&error.keyword==='additionalProperties'?' visualize只展示已有ref或用pick选人；筛选、排序、分页请先调用query得到ref后再传给visualize。':''
      throw new Error(`工具参数无效：${error.instancePath || '/'} ${error.message} ${JSON.stringify(error.params)}。请修正该字段，已有ref继续可用。${extra}`)
    }
    if (name === 'catalog') {
      const names = args.dataset ? [args.dataset] : datasets
      return { metadata: data.metadata, datasets: names.map(dataset => { const table = resolve(dataset); return { name: dataset, count: table.rows.length, columns: table.columns } }), sources: data.sources.slice(0,12), source_summary:[...new Set(data.sources.map(source=>source.kind))].map(kind=>({kind,count:data.sources.filter(source=>source.kind===kind).length})), source_note:'sources仅预览前12条，完整来源可query sources；查询具体导师资料时自动返回其网页出处。', tools: toolDefinitions.map(t => t.function.name) }
    }
    if (name === 'query') {
      const table = derived(resolve(args.from),args.derive), filtered = filterRows(table, args.filters)
      let rows = sorted(filtered, table.columns, args)
      const sourceByRow=new Map(table.rows.map((row,index)=>[row,table.row_source_ids?.[index]||row.source_ids||table.source_ids]))
      const rowSources=rows.map(row=>sourceByRow.get(row)),sourceIds=unique(rowSources.flat())
      let columns=table.columns
      if(args.row_number_as){
        if(columns.some(column=>column.key===args.row_number_as))throw new Error('编号列不能覆盖已有字段')
        rows=rows.map((row,index)=>({...row,[args.row_number_as]:index+1}))
        columns=[...columns,{key:args.row_number_as,label:args.row_number_as,type:'number',role:'ordinal'}]
      }
      const defaultSelect=args.from==='exams'?['student_name',...columns.map(column=>column.key).filter(key=>key!=='student_name')]:defaults[args.from]?[...defaults[args.from],...(args.derive||[]).map(column=>column.as),...(args.row_number_as?[args.row_number_as]:[])]:undefined
      let select=args.select??defaultSelect
      if(args.row_number_as&&select&&!select.includes(args.row_number_as))select=[args.row_number_as,...select]
      const result = selected(rows, columns, select)
      const saved=save({ ...result, row_source_ids:rowSources, source_ids: sourceIds }, args)
      if(!saved.rows.length&&args.filters?.some(filter=>filter.field==='program'&&/^\d{6}$/.test(String(filter.value))))saved.notes.push('program存专业中文名称。六位代码请在exams中用program_code筛选；专业名称可从该结果获取，再继续关联或筛选。')
      if(!saved.rows.length&&args.filters?.some(filter=>['name','mentor_name'].includes(filter.field))){
        const values=args.filters.filter(filter=>['name','mentor_name'].includes(filter.field)).flatMap(filter=>Array.isArray(filter.value)?filter.value:[filter.value]).filter(value=>typeof value==='string')
        const hints=values.flatMap(value=>homophoneMatches(value,data.mentors).map(mentor=>`未找到“${value}”；已收录同音相近导师：${mentor.name}（${mentor.college}），请改用已收录姓名查询。`))
        if(hints.length)saved.notes.push(...new Set(hints))
      }
      return saved
    }
    if(name==='search') {
      const all=index().search(args.terms,args.mode)
      const originalColumns=resolve('mentors').columns
      const columns=columnsFor(all,[...new Set([...Object.keys(data.mentors[0]||{}),'candidate_id','matched_topics','topic_basis','topic_evidence','training_evidence','group_lead','can_supervise_doctoral',...all.flatMap(row=>Object.keys(row))])]).map(column=>originalColumns.find(original=>original.key===column.key)||column)
      const rows=sorted(filterRows({rows:all,columns},args.filters),columns,args)
      const sourceIds=rows.map(row=>row.source_ids||[])
      return save({...selected(rows,columns,args.select),row_source_ids:sourceIds,source_ids:unique(sourceIds.flat())},args)
    }
    if (name === 'join') {
      const left = resolve(args.left), right = resolve(args.right)
      assertField(left.columns, args.left_on); assertField(right.columns, args.right_on)
      if (args.how && !['left', 'inner'].includes(args.how)) throw new Error('how 必须是 inner 或 left')
      const leftKeys = new Set(left.columns.map(c => c.key))
      const rightColumns = right.columns.map(c => ({ ...c, key: leftKeys.has(c.key) ? `right_${c.key}` : c.key }))
      if (new Set([...leftKeys, ...rightColumns.map(c => c.key)]).size !== left.columns.length + right.columns.length) throw new Error('连接后字段重名；请先 query 选择需要的列')
      const index = new Map()
      for (const row of right.rows) {
        const key = row[args.right_on]
        if (key != null) { if (!index.has(key)) index.set(key, []); index.get(key).push(row) }
      }
      const rows = left.rows.flatMap(l => {
        const matches = l[args.left_on] == null ? [] : index.get(l[args.left_on]) ?? []
        return (matches.length ? matches : args.how === 'left' ? [null] : []).map(r => ({ ...l, ...Object.fromEntries(right.columns.map((c, i) => [rightColumns[i].key, r?.[c.key] ?? null])) }))
      })
      return save({ ...selected(rows, [...left.columns, ...rightColumns], args.select), source_ids: unique([...left.source_ids, ...right.source_ids]) }, args)
    }
    if (name === 'aggregate') {
      const table = resolve(args.from), groupBy = args.group_by ?? []
      groupBy.forEach(field => assertField(table.columns, field))
      if (!Array.isArray(args.metrics) || !args.metrics.length) throw new Error('至少提供一个统计指标')
      const aliases = new Set(groupBy)
      for (const metric of args.metrics) {
        if (!['count', 'mean', 'median', 'min', 'max', 'sum', 'quantile', 'stddev', 'correlation','values'].includes(metric.op)) throw new Error(`未知统计操作 ${metric.op}`)
        if (!metric.as || aliases.has(metric.as)) throw new Error('统计列 as 必须存在且不与其他列重名')
        aliases.add(metric.as)
        if (metric.field) assertField(table.columns, metric.field)
        if (metric.op !== 'count' && !metric.field) throw new Error(`${metric.op} 需要 field`)
        if (metric.op === 'quantile' && !(metric.q >= 0 && metric.q <= 1)) throw new Error('quantile 需要 0–1 的 q')
        if (metric.op === 'correlation') assertField(table.columns,metric.with)
      }
      if (args.bucket) {
        assertField(table.columns, args.bucket.field)
        if (!(args.bucket.width > 0) || !Number.isFinite(args.bucket.width)) throw new Error('分桶宽度必须大于 0')
        if (groupBy.includes('bucket')) throw new Error('bucket 由分桶操作生成，无需写入 group_by')
        aliases.add('bucket')
      }
      const groups = new Map(), fields = [...groupBy, ...(args.bucket ? ['bucket'] : [])]
      for (const row of filterRows(table, args.filters)) {
        if (args.bucket && typeof row[args.bucket.field] !== 'number') continue
        const group = Object.fromEntries(groupBy.map(k => [k, row[k] ?? null]))
        if (args.bucket) group.bucket = round(Math.floor(row[args.bucket.field] / args.bucket.width) * args.bucket.width)
        const key = JSON.stringify(group)
        if (!groups.has(key)) groups.set(key, { group, rows: [] })
        groups.get(key).rows.push(row)
      }
      if (!fields.length && !groups.size) groups.set('{}', { group: {}, rows: [] })
      const rows = [...groups.values()].map(({ group, rows }) => ({ ...group, ...Object.fromEntries(args.metrics.map(m => {
        const values = m.field ? rows.map(row => row[m.field]).filter(v => v != null) : rows
        const nums = numeric(values)
        if (!['count','values'].includes(m.op) && nums.length !== values.length) throw new Error(`${m.field} 不是数值字段`)
        let value = null
        if (m.op === 'count') value = values.length
        else if(m.op==='correlation') {
          const pairs=rows.filter(row=>row[m.field]!=null&&row[m.with]!=null)
          if(pairs.some(row=>typeof row[m.field]!=='number'||typeof row[m.with]!=='number'))throw new Error('相关系数需要两个数值字段')
          if(pairs.length>1) {
            const meanX=pairs.reduce((sum,row)=>sum+row[m.field],0)/pairs.length,meanY=pairs.reduce((sum,row)=>sum+row[m.with],0)/pairs.length
            let xx=0,yy=0,xy=0
            for(const row of pairs){const x=row[m.field]-meanX,y=row[m.with]-meanY;xx+=x*x;yy+=y*y;xy+=x*y}
            value=xx&&yy?xy/Math.sqrt(xx*yy):null
          }
        }
        else if (nums.length) {
          if (m.op === 'sum') value = nums.reduce((a, b) => a + b, 0)
          if (m.op === 'mean') value = nums.reduce((a, b) => a + b, 0) / nums.length
          if (m.op === 'median') value = quantile(nums, 0.5)
          if (m.op === 'quantile') value = quantile(nums, m.q)
          if (m.op === 'min') value = Math.min(...nums)
          if (m.op === 'max') value = Math.max(...nums)
          if (m.op === 'stddev'&&nums.length>1) {const mean=nums.reduce((a,b)=>a+b,0)/nums.length;value=Math.sqrt(nums.reduce((sum,n)=>sum+(n-mean)**2,0)/(nums.length-1))}
        }
        return [m.as, m.op==='values'?values:round(value)]
      })) }))
      const columns = [...fields.map(key => ({...(table.columns.find(c => c.key === key) || { key, label: '区间起点（左闭右开）', type: 'number' }),role:'dimension'})), ...args.metrics.map(m => ({ key: m.as, label: fieldLabels[m.as] || m.as, type:m.op==='values'?'array':'number',role:'statistic' }))]
      const saved=save({ rows: sorted(rows, columns, args.bucket && !args.sort_by ? { ...args, sort_by: 'bucket', order: 'asc' } : args), columns, source_ids: table.source_ids }, args)
      if(!saved.rows.length&&args.filters?.some(filter=>filter.field==='program'&&/^\d{6}$/.test(String(filter.value))))saved.notes.push('program是专业中文名称，六位专业代码应使用program_code；本次空结果来自字段与值不对应，请修正筛选字段。')
      return saved
    }
    if (name === 'visualize') {
      if(args.discard)return {discarded:args.discard,message:'该图表已从本轮展示移除，查询结果继续保留。'}
      if (!tables[args.from]&&args.type!=='table') throw new Error('统计图必须消费已有结果 ref。请先 query 或 aggregate，再传入返回的 ref。')
      let input = resolve(args.from),ref=args.from,projected=false
      const previous=args.replace&&Object.values(tables).find(table=>table.view?.id===args.replace)
      // Final displays may join omitted mentor fields by a verified identity.
      // Query projections remain unchanged; derived values and people are never replaced.
      const noteBy=!Array.isArray(args.row_notes)?args.row_notes?.by:null
      const neededKeys=unique([...(args.select||[]),...(noteBy?[noteBy]:[])])
      const missing=neededKeys.filter(key=>key!==args.row_number_as&&!input.columns.some(column=>column.key===key))
      if(args.type==='table'&&missing.length&&input.rows.length){
        const mentors=resolve('mentors'),extra=missing.map(key=>mentors.columns.find(column=>column.key===key))
        const matches=input.rows.map(row=>{
          const found=mentors.rows.filter(mentor=>row.mentor_id!=null?mentor.mentor_id===row.mentor_id:row.name!=null&&row.college!=null&&mentor.name===row.name&&mentor.college===row.college)
          return found.length===1&&input.columns.filter(column=>column.key!=='source_ids'&&mentors.columns.some(c=>c.key===column.key)).every(column=>JSON.stringify(row[column.key]??null)===JSON.stringify(found[0][column.key]??null))?found[0]:null
        })
        if(extra.every(Boolean)&&matches.every(Boolean)){
          const rowSources=input.rows.map((row,index)=>unique([...(input.row_source_ids?.[index]||input.source_ids||[]),...(matches[index].source_ids||[])]))
          const enriched=save({...input,rows:input.rows.map((row,index)=>({...row,...Object.fromEntries(missing.map(key=>[key,matches[index][key]??null]))})),columns:[...input.columns,...extra],row_source_ids:rowSources,source_ids:unique(rowSources.flat())},{limit:5000})
          ref=enriched.ref;input=resolve(ref)
        }
      }
      if(args.pick||args.row_number_as||!tables[args.from]){
        if(args.pick){
          assertField(input.columns,args.pick.field)
          for(const value of args.pick.values){
            const matches=input.rows.filter(row=>row[args.pick.field]===value)
            if(!matches.length){
              const hints=['name','mentor_name'].includes(args.pick.field)&&typeof value==='string'?homophoneMatches(value,input.rows):[]
              const hintText=hints.length?`（已收录同音姓名：${[...new Set(hints.map(row=>`${row[args.pick.field]}（${row.college||''}）`))].join('、')}）`:''
              throw new Error(`当前资料中找不到 ${value}${hintText}，请从已有真实记录中选择`)
            }
            if(matches.length>1)throw new Error(`${value} 匹配多条记录，请用唯一字段如mentor_id区分`)
          }
        }
        const querySelect=args.select?unique([...args.select,...(noteBy&&input.columns.some(c=>c.key===noteBy)?[noteBy]:[])]):input.columns.map(column=>column.key)
        const result=execute('query',{from:ref,select:querySelect,...(args.pick?{filters:[{field:args.pick.field,op:'in',value:args.pick.values}],sort:[{field:args.pick.field,values:args.pick.values}]}:{}),...(args.row_number_as?{row_number_as:args.row_number_as}:{}),limit:Math.min(5000,Math.max(1,input.rows.length))})
        if(result.total>result.returned)throw new Error('单张图表最多5000行，请先筛选或分组统计')
        ref=result.ref;input=resolve(ref);projected=true
      }
      if(!projected)args.select?.forEach(field => assertField(input.columns, field))
      const visibleKeys = input.columns.filter(c => !internalColumn(c) && (args.select || !/(^|_)match_status$/.test(c.key))).map(c => c.key)
      const select = args.select&&!projected ? args.select.filter(key => visibleKeys.includes(key)) : visibleKeys
      if (!select.length) throw new Error('请选择可展示的业务字段')
      const table = { ...input, ...selected(input.rows, input.columns, select) }
      if (!['bar', 'line', 'scatter', 'table', 'metric'].includes(args.type)) throw new Error('未知可视化类型')
      if (!args.title?.trim()) throw new Error('需要图表标题')
      const expected = titleCount(args.title)
      const nameColumn = ['mentor_name', 'name'].find(key => table.columns.some(c => c.key === key))
      if (expected != null && !expected.students && nameColumn) {
        const actual = new Set(table.rows.map(row => `${row.college||''}:${row[nameColumn]}`)).size
        if (expected.maximum ? actual > expected.count : actual !== expected.count) throw new Error(`标题声明 ${expected.count} 位，当前结果实际包含 ${actual} 位。请先 query 当前结果 ref，用 filters 筛出最终候选后再 visualize；select 只选列，不会筛选行。图表名单必须与用户要求和正文推荐一致，不能只改标题掩盖范围差异。`)
      }
      const caption = args.title + ' ' + (args.description || '')
      const programs = unique(data.exams.flatMap(row => [row.program_code, row.program?`${row.program}专业`:null]).filter(Boolean))
      if (programs.some(program => caption.includes(program)) && !/全专业|全部专业|跨专业/.test(args.title) && table.columns.some(column => column.statistic_scope === 'all_programs')) {
        throw new Error('图表标题限定了专业，但选中的人数或分数列是全部专业汇总。请从 exams/students 按该专业筛选并 aggregate，再 join 导师条件；如果确实展示整体背景，必须明确标注全专业统计。')
      }
      const declared=[...new Map(data.exams.map(row=>[row.program_code,row.program]))].filter(([code,program])=>args.title.includes(code)||args.title.includes(`${program}专业`))
      if(declared.length===1&&!/全专业|全部专业|跨专业/.test(args.title)) {
        const [code,program]=declared[0]
        if(table.rows.some(row=>row.program_code!=null&&row.program_code!==code||row.program!=null&&data.exams.some(exam=>exam.program===row.program)&&row.program!==program))throw new Error(`标题限定${code}，结果中却含其他专业。请先按${code}筛选exams再关联；无本专业样本应保留为空，不能混入其他专业分数。确需跨专业参考时必须在标题明确标注跨专业。`)
      }
      if (table.rows.length > 5000) throw new Error('单张图表最多5000行，请先按业务条件筛选或分组统计')
      if (args.type !== 'table') {
        if(args.type!=='metric'||args.x)assertField(table.columns,args.x)
        if (!args.y?.length || args.y.length > 4) throw new Error('y 需要 1–4 个数值字段')
        for (const y of args.y) {
          assertField(table.columns, y)
          if (table.rows.some(row => row[y] != null && (typeof row[y] !== 'number' || !Number.isFinite(row[y])))) throw new Error(`${y} 必须是数值字段`)
        }
        if (args.type === 'scatter' && table.rows.some(row => row[args.x] != null && typeof row[args.x] !== 'number')) throw new Error('散点图的 x 必须是数值字段')
        if (args.color_by) {
          if (args.type !== 'scatter') throw new Error('颜色分组用于散点图；其他图表的数值系列使用 y')
          assertField(table.columns,args.color_by)
        }
      }
      const purpose=args.purpose||(table.columns.some(column=>column.role==='statistic')&&table.columns.every(column=>['dimension','statistic','ordinal'].includes(column.role))?'statistics':undefined)
      const inherited=row=>{
        const index=previous?.rows.findIndex(old=>{
          const id=['mentor_id','candidate_id','student_id','exam_id','review_id','profile_id'].find(key=>old[key]!=null&&row[key]!=null)
          const same=id?old[id]===row[id]:old.name!=null&&old.college!=null&&old.name===row.name&&old.college===row.college
          return same&&previous.columns.filter(column=>!ordinalColumn(column)&&table.columns.some(c=>c.key===column.key)).every(column=>JSON.stringify(old[column.key]??null)===JSON.stringify(row[column.key]??null))
        })
        return index>=0?previous.view.notes?.[index]??null:null
      }
      let rowNotes=args.row_notes
      if(rowNotes&&!Array.isArray(rowNotes)){
        const {by,entries}=rowNotes;assertField(input.columns,by)
        if(new Set(entries.map(entry=>entry.value)).size!==entries.length)throw new Error(`说明必须对应当前记录，不能重复或指向名单之外。${by}的实际值：${JSON.stringify(input.rows.map(row=>row[by]))}`)
        const matchValue=(row,value)=>row[by]===value||['name','mentor_name'].includes(by)&&typeof value==='string'&&[`${row[by]}（${row.college||''}）`,`${row[by]}(${row.college||''})`].includes(value)
        const resolved=input.rows.map(inherited)
        for(const entry of entries){
          const matches=input.rows.flatMap((row,index)=>matchValue(row,entry.value)?[index]:[])
          if(!matches.length)throw new Error(`说明必须对应当前记录，不能重复或指向名单之外。${by}的实际值：${JSON.stringify(input.rows.map(row=>row[by]))}`)
          if(matches.length>1)throw new Error(`注释值 ${entry.value} 在当前表中匹配多条同名记录，请改用 by:"mentor_id"（无需放入展示列）或写成“姓名（学院）”区分。`)
          resolved[matches[0]]=entry.text
        }
        rowNotes=resolved
      }
      if(!rowNotes&&previous?.view.notes)rowNotes=input.rows.map(inherited)
      if(rowNotes&&rowNotes.length!==table.rows.length)throw new Error(`实际结果有${table.rows.length}行，逐行说明只有${rowNotes.length}条。只选名单时请用pick筛选并排序；sort.values只排序。`)
      if(rowNotes&&!rowNotes.some(Boolean))rowNotes=undefined
      const id=args.replace||`view-${randomUUID()}`
      if(previous)delete previous.view
      tables[ref].view={id,notes:rowNotes}
      return { artifact: { id, from:ref, type: args.type,purpose,row_notes:rowNotes, title: cleanDefensiveText(args.title), description: cleanDefensiveText(args.description || ''), x: args.x, y: args.y || [], color_by: args.color_by, rows: table.rows, columns: table.columns, sources: sourceObjects(table.source_ids) }, sources: sourceObjects(table.source_ids), rows: table.rows.length, message: '图表数据已准备；replace可只修改变动行的具名说明，其余说明按相同记录保留。更换人选时用原数据集或包含新人的ref和pick，不从旧名单的窄ref找新人物。正文无需重复整表。' }
    }
    throw new Error(`未知工具 ${name}`)
  }
  return { execute, tables, acceptInput }
}

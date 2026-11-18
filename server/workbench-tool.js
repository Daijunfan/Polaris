import Ajv from 'ajv'
import {mentorComparisonFields} from '../lib/fields.js'
import {filtersSchema} from '../lib/tools.js'
import {profileOptions} from '../lib/profile.js'

export const workbenchToolDefinition={type:'function',function:{name:'workspace',description:'读写用户的导师工作台。用户明确要求收藏、建清单、备注、比较、保存方案或导出报告时调用，操作成功才可说已保存。from可直接消费本轮query/search结果ref，或用mentors传真实姓名与学院。read默认读取收藏库，scope:comparison才读取当前对比；返回的comparison元数据始终给出当前名单、目标与维度。read默认不读取个人备注；需要用户备注时include_notes:true。read返回已存方案与模板元数据，restore使用对应saved_type和saved_id载入，保留最新私人备注。restore已经设置当前对比，随后直接report即可导出这份名单，无须再用compare重建。report默认导出当前对比，也可显式scope:library导出收藏库，生成持久文件下载卡片。所有操作执行真实会员限制，不修改模型、评分或账号等级。',parameters:{type:'object',additionalProperties:false,properties:{
  action:{type:'string',enum:['read','save','remove','compare','list','note','snapshot','template','restore','report','undo','analyze','view','scenario']},
  from:{type:'string',description:'已有导师查询ref；只消费该ref实际行。'},
  mentors:{type:'array',minItems:1,maxItems:1000,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},college:{type:'string'}},required:['name']}},
  list_name:{type:'string',description:'仅用于用户自己命名的分类清单；默认候选库留空。save时不存在会创建，read/remove时在该清单内操作。'},
  name:{type:'string',maxLength:80,description:'新清单、方案、模板或报告名称。'},
  note:{type:'string',maxLength:2000,description:'用户自己的备注，不是导师评价。'},
  status:{type:'string',enum:['considering','priority','contacted'],description:'用户联系进度：待比较、重点联系、已联系。'},
  fields:{type:'array',minItems:1,items:{type:'string',enum:mentorComparisonFields.map(field=>field.key)}},
  format:{type:'string',enum:['html','md','csv']},
  include_notes:{type:'boolean'},
  scope:{type:'string',enum:['library','comparison'],description:'read默认library收藏库，report默认comparison当前对比。两份名单独立，读取不会修改对比。'},
  saved_type:{type:'string',enum:['snapshot','template'],description:'restore载入已存方案或模板。'},
  saved_id:{type:'string',description:'从read的snapshots或templates中取得实际ID。'},
  limit:{type:'integer',minimum:1,maximum:1000},
  offset:{type:'integer',minimum:0},
  filters:filtersSchema,
  scenario_ids:{type:'array',minItems:2,maxItems:2,items:{type:'string'},description:'方案ID可从read返回的snapshots元数据获取。'},
},required:['action']}}}
const validate=new Ajv({strict:false}).compile(workbenchToolDefinition.function.parameters)
export function validateWorkbenchAction(input){if(!validate(input))throw new Error('工作台参数无效：'+validate.errors.map(error=>error.instancePath+' '+error.message).join('；'))}

export const profileToolDefinition={type:'function',function:{name:'profile',description:'读取或更新用户的择导画像（报考方式、分数、专业、目标、关注学院、看重的条件、兴趣方向）。用户说“记住/以后默认/我的情况是…”或明确改变长期偏好时用update，只传变化的字段；画像会显示在输入框上方，用户可随时修改。不要把一次性的筛选条件写进画像。',parameters:{type:'object',additionalProperties:false,properties:{
  action:{type:'string',enum:['read','update']},
  stage:{type:['string','null'],enum:[...profileOptions.stage.map(item=>item.value),null]},
  goal:{type:['string','null'],enum:[...profileOptions.goal.map(item=>item.value),null]},
  score:{type:['integer','null'],minimum:0,maximum:500},
  program:{type:['string','null'],maxLength:120,description:'专业名称或六位代码'},
  colleges:{type:'array',items:{type:'string'},maxItems:16},
  musts:{type:'array',items:{type:'string',enum:profileOptions.musts.map(item=>item.value)},description:'看重的条件：internship能实习、no_clock不打卡、stipend补助高、personal亲自指导、no_paper不卡论文、kind尊重学生、doctoral博导、resources项目资源多'},
  interests:{type:'string',maxLength:120},
  notes:{type:'string',maxLength:600},
},required:['action']}}}
const validateProfile=new Ajv({strict:false}).compile(profileToolDefinition.function.parameters)
export function validateProfileAction(input){if(!validateProfile(input))throw new Error('画像参数无效：'+validateProfile.errors.map(error=>error.instancePath+' '+error.message).join('；'))}

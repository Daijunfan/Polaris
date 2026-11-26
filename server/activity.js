import { randomUUID } from 'node:crypto'

export function toolActivity(name,args={}) {
  const labels={profile:({read:'读取择导画像',update:'更新择导画像'})[args.action]||'读取择导画像',workspace:({read:args.scope==='comparison'?'读取当前对比':'读取已收藏导师',save:'收藏导师',remove:'移出候选',compare:'更新导师对比',list:'整理分类清单',note:'保存导师备注',snapshot:'保存对比方案',template:'保存对比模板',restore:'载入已存方案',analyze:'联动筛选候选',view:'保存动态视图',scenario:'对照方案变化',report:'生成对比报告',undo:'恢复候选记录'})[args.action]||'更新工作台',export_file:'生成导出文件',catalog:'读取资料目录',search:'检索相关方向与导师',query:({mentors:'查阅导师资料',profiles:'查阅官网与公开介绍',reviews:'读取培养与管理评价',students:'核对学生名册',exams:'核对考试成绩',sources:'查阅资料来源'})[args.from]||'筛选查询结果',join:'关联导师与学生资料',aggregate:'统计与计算',visualize:({table:'整理对比表',bar:'绘制柱状图',scatter:'绘制散点图',line:'绘制折线图',metric:'生成指标卡'})[args.type]||'准备可视化',get_goal:'核对目标要求',complete_goal:'确认目标交付',pause_goal:'记录待补充条件'}
  const people=(args.filters||[]).filter(filter=>['name','mentor_name','student_name'].includes(filter.field)&&['eq','in'].includes(filter.op)).flatMap(filter=>Array.isArray(filter.value)?filter.value:[filter.value]).filter(value=>typeof value==='string').slice(0,3)
  const topics=name==='search'?(args.terms||[]).slice(0,2):[]
  const qualification=(args.filters||[]).some(filter=>filter.field==='can_supervise_doctoral'&&filter.op==='eq'&&filter.value===true)
  return `${qualification?'查找可指导博士的相关导师':labels[name]||'处理查询'}${people.length?` · ${people.join('、')}`:topics.length?` · ${topics.join(' / ')}`:''}`
}

export function createActivity(message,emit) {
  message.activity ||= []
  function finish(status='complete',extra={}) {
    const current=message.activity.at(-1)
    if(current?.status==='running')Object.assign(current,{status,finishedAt:new Date().toISOString(),...extra})
  }
  function notify(){emit('progress',{text:message.progress,content:message.content,activity:message.activity})}
  return {
    begin(kind,label){finish();message.activity.push({id:randomUUID(),kind,label,status:'running',startedAt:new Date().toISOString()});message.progress=label;notify()},
    update(label){const current=message.activity.at(-1);if(current?.status==='running'&&current.label!==label){current.label=label;message.progress=label;notify()}},
    finish,
  }
}

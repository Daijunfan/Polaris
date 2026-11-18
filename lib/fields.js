export const fieldLabels = {
  candidate_id:'候选记录 ID',directory_college:'招生目录学院',matched_topics:'相关研究主题',topic_basis:'主题依据',topic_evidence:'相关资料与职责',group_lead:'负责组管理',can_supervise_doctoral:'可指导博士',
  web_profiles:'网页介绍条数',web_teachers:'网页覆盖导师数',profiled_mentors:'有网页介绍的导师数',
  mentor_id: '导师 ID', name: '导师', college: '学院', group: '招生组', directions: '团队招生方向', personal_directions: '个人研究方向',mentor_note:'导师评价', rating: '培养体验评分 / 5',
  stipend_monthly: '月劳务（元）', stipend_monthly_min: '月劳务记录低值（元）', stipend_monthly_max: '月劳务记录高值（元）', stipend_text: '补助与支付条件',
  management: '管理与考勤', internship: '实习情况', graduation: '论文与毕业', review_text: '培养评价', review_note: '评价说明', group_context: '团队分工与培养安排',
  student_count: '名册学生数', exam_count: '考研人数', recommended_count: '保研人数', exam_ratio: '考研占比（%）', recommended_ratio: '保研占比（%）',
  admission_type: '招生类型', score_first_min: '历史初试最低分', score_first_mean: '历史初试均分',
  score_first_median: '历史初试中位分', score_first_max: '历史初试最高分',
  student_id: '匿名学生 ID', student_name: '学生姓名', exam_id: '匿名考生 ID', mentor_name: '导师', program: '专业名称', program_code: '专业代码',
  year: '资料年份', score_first: '初试总分', score_reexam: '复试成绩', score_total: '加权总成绩',
  politics: '政治', foreign_language: '外国语', subject_one: '业务课一', subject_two: '业务课二',
  admitted: '拟录取', match_status: '成绩归属说明', rank_first: '学院初试排名', rank_first_program: '专业内初试排名',
  review_id: '评价 ID', text: '评价内容', source_ids: '来源', source_locator: '资料来源', note: '说明', id: '来源 ID', title: '标题', kind: '来源类型', file: '原始资料', scope: '覆盖范围',
  profile_id:'网页记录 ID',professional_title:'职称',supervisor_type:'导师类型',research_areas:'网页研究领域',biography:'个人简介',programs:'指导专业',contact_email:'公开邮箱',team_description:'团队介绍',projects:'科研项目',achievements:'研究成果',teaching:'教学与经历',admissions:'招生与指导学科',page_title:'网页标题',url:'原始网页',publisher:'发布机构',source_type:'资料类别',published_at:'发布日期',fetched_at:'抓取日期',
  assistant_note:'要点与取舍',green_flags:'优点标签',red_flags:'风险标签',watch_flags:'注意事项',actual_supervisor:'实际带教人',academic_summary:'学术与项目概览',enrollment_signal:'生源与学生选择',training_evidence:'培养与项目记录',profile_evidence:'公开研究与指导资料',research_evidence:'科研培养与平台资料',doctoral_evidence:'博士指导依据',
  count: '样本数', mean: '均值', median: '中位数', min: '最小值', max: '最大值', sum: '合计', p25: '下四分位', p75: '上四分位', bucket: '分数区间',
}

export const mentorComparisonFields=['rating','green_flags','red_flags','actual_supervisor','academic_summary','enrollment_signal','personal_directions','directions','management','internship','graduation','stipend_text','research_evidence','profile_evidence','can_supervise_doctoral','doctoral_evidence','student_count','exam_count','recommended_count'].map(key=>({key,label:fieldLabels[key]}))
export const defaultComparisonFields=['rating','green_flags','red_flags','personal_directions','management','internship','graduation','stipend_text','research_evidence','can_supervise_doctoral']
export const comparisonGoals={
  '培养体验':['rating','management','internship','graduation','stipend_text'],
  '就业实习':['rating','enrollment_signal','personal_directions','management','internship','graduation','stipend_text'],
  '科研深造':['rating','academic_summary','enrollment_signal','personal_directions','directions','research_evidence','profile_evidence','can_supervise_doctoral','doctoral_evidence'],
}
export const contactStatuses={considering:'待比较',priority:'重点联系',contacted:'已联系'}
export const mentorFilterFields=[
  {key:'college',label:'学院',type:'string'},
  {key:'rating',label:'培养体验评分',type:'number'},
  {key:'green_flags',label:'优点标签',type:'string'},
  {key:'red_flags',label:'风险标签',type:'string'},
  {key:'can_supervise_doctoral',label:'可指导博士',type:'boolean'},
  {key:'personal_directions',label:'个人方向',type:'string'},
  {key:'internship',label:'实习安排',type:'string'},
  {key:'graduation',label:'毕业要求',type:'string'},
  {key:'stipend_text',label:'补助条件',type:'string'},
  {key:'status',label:'联系进度',type:'string',options:Object.entries(contactStatuses).map(([value,label])=>({value,label}))},
]
export function differingComparisonFields(rows,fields){
  const normalize=value=>value==null||typeof value==='string'&&!value.trim()?'':typeof value==='string'?value.replace(/\s+/g,''):JSON.stringify(value)
  return fields.filter(key=>new Set(rows.map(row=>normalize(row[key]))).size>1)
}

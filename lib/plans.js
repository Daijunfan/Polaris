// 北极星是完整开源产品：所有能力对每位用户开放，没有付费档位。
// 保留 plan 结构仅为兼容旧存储与旧接口，任何旧档位都映射为完整版。
export const allFeatures=['notes','csv','reports','goals','visuals','lists','linked','views','differences','snapshots','templates','scenarios']
export const fullPlan={id:'full',name:'完整版',level:3,focus:'完整工作流',description:'全部功能开放',features:allFeatures,depth:{compare:'自定义维度、差异聚焦与多方案权衡',visuals:'图表与名单联动、方案差异对照',organize:'候选、清单、动态视图、方案版本',report:'含图表、差异、方案历史的完整报告'}}
export const plans=[fullPlan]
export const planById=()=>fullPlan
export const featureNames={notes:'个人记录',csv:'数据导出',reports:'事实报告',goals:'目标化比较',visuals:'多视角图表',lists:'分类整理',linked:'复合条件联动',views:'动态条件视图',differences:'差异聚焦',snapshots:'方案版本',templates:'自定义分析模板',scenarios:'多方案差异对照'}
export function planError(feature){
  return Object.assign(new Error(feature+'暂不可用'),{status:403,code:'FEATURE_UNAVAILABLE'})
}

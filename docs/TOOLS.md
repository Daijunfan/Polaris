# 工具协议

同一个 `createToolRuntime()` 实现供 CLI、HTTP 和模型 Function Calling 使用。完整 JSON Schema 可运行 `node bin/mentor.mjs schemas`，或读取 `GET /api/tools`。

CLI／工具调用使用内部数据协议。聊天页面、消息事件和导出使用独立的展示投影：内部 ID、文件定位与调用参数不传给界面，来源转换为可读引用。不要把工具原始 JSON 直接渲染到用户页面。

推荐交付以最终入选名单为范围，附带的具名导师样本表也只展示入选者。原查询ref仍保留完整候选结果，可继续查询、统计或主动查看全部。未主动询问的排除说明不进入正文、复制和导出；明确追问某人为什么未入选时，正常回答该问题。

## 数据集

| 名称 | 核心字段 | 用途 |
| --- | --- | --- |
| `mentors` | `mentor_id,name,college,group,directions,personal_directions,rating`；`management,internship,graduation,review_text,group_context`；`stipend_monthly_min,stipend_monthly_max,stipend_text,review_note`；`student_count,exam_count,recommended_count,exam_ratio,recommended_ratio,score_first_min,score_first_mean,score_first_median,score_first_max` | 导师摘要、招生类型人数与占比、历史样本和培养条件 |
| `students` | `student_name,student_id,mentor_id,mentor_name,program,admission_type,match_status,score_first,score_reexam,score_total,rank_first,rank_first_program` | 匿名名册，一条记录对应一个学生 |
| `exams` | `student_name,exam_id,student_id,mentor_id,mentor_name,program,program_code,year,score_first,politics,foreign_language,subject_one,subject_two,score_reexam,score_total,admitted,match_status,rank_first,rank_first_program` | 进入复试者的完整成绩样本 |
| `reviews` | `review_id,mentor_id,name,college,group,rating,text,stipend_text,source_locator,note` | 个人培养评价与招生组共同安排；共性记录的 `mentor_id` 为 null |
| `profiles` | `profile_id,mentor_id,name,college,professional_title,supervisor_type,research_areas,biography,contact_email,programs,team_description,projects,achievements,teaching,admissions,page_title,url,publisher,source_type,published_at,fetched_at` | 一行对应一个公开网页，同一导师可有官网和多个第三方页面；详情需显式选列 |
| `sources` | `id,title,kind,year,file,scope,note,url,publisher,published_at,fetched_at` | 数据来源和限制；公开网页可直接访问，内部文件定位不展示 |

`directions` 是团队招生范围，`personal_directions` 是从个人评价归纳提取的个人研究方向。主题推荐同时考虑个人资料，以及相关团队方向与明确的管理、指导职责；团队依据按团队归因。用户明确限定个人方向时才只保留个人方向证据。`mentors` 的人数和历史分数汇总覆盖全部专业；指定专业或分数段应先筛选 `exams` / `students`，再聚合和关联。

`catalog` 是字段类型与当前数据范围的权威入口。扩展数据后，数量和字段可改变，不应把本页数字写死在 Agent 逻辑中。

`metadata.colleges` 和 `metadata.coverage` 给出实际已收录学院及各院导师、评分、名册和成绩记录数。开放推荐先读取全体简要候选，再按需查详情；比较表保留college和group。只有评价而无名册的导师，人数与分数为null。同名导师按mentor_id和学院区分，官网仅沿用已有明确关联，不把同名网页拼给另一学院的记录。

`mentors.mentor_note` 保存导师方向、培养与招生的第三方评价，与其他导师评价同类查询和引用；明确的个人情况优先于旧组内泛化描述。`data/mentor-notes.json` 可显式指定 `group_context:null`，表示该人的培养不继承组内共性；未指定时沿用原记录。个人查询、主题检索和管道结果都使用此覆盖，内置 Agent 的 `personal_conditions` 同时携带适用范围。付俊松由本人直接指导，其个人记录不带八组统一培养的组会、假期和压力描述；八组完整评价记录仍在 `reviews`，只用于查询组整体。不能把通常生源说成当年确定名额。

`stipend_monthly_min/max` 是资料所载月劳务金额或区间端点，供数值筛选、排序和作图；相等时表示同一个记载金额，不表示实际收入保底或封顶。表格同时选择两列时，展示层合并为“月劳务（元）”：单值显示一次、区间显示为一项范围，条件保留在`stipend_text`。API原始数值与ref不变，旧对话表格和导出使用相同展示规则。

已有对应导师对照表时，正文中列名、人员均被该表覆盖的重复手写表不再单独显示；复制与导出保留工具准备的实际数据表，避免正文另写一份不同数值。

网页介绍与旧名册独立：`profiles.mentor_id` 在全部评价加载后按姓名与学院关联，保留已有明确关联，不把另一学院的同名网页拼过来。未匹配评价的官网人物仍参与search，并可从搜索ref按candidate_id继续筛选、排序和可视化；不能到mentors中查找不存在的绑定，也不能补造其评分、名册或成绩。`source_type` 区分官网和第三方；`fetched_at` 为抓取日，不是发布日期或在招证明。`catalog.sources` 只预览前12条，完整列表使用 `query sources`，具体查询会返回实际网页出处。

```sh
node bin/mentor.mjs query --from profiles --where '[{"field":"name","op":"eq","value":"付俊松"}]' --select name,professional_title,research_areas,contact_email,source_type,url,fetched_at
node bin/mentor.mjs query --from profiles --where '[{"field":"research_areas","op":"contains","value":"大模型安全"}]' --select name,research_areas,source_type,url
npm run data:crawl
```

招生类型规则：名册有初试成绩为 `exam`（考研），没有初试成绩为 `recommended`（保研，包含尚未唯一匹配成绩者）；`match_status` 仅表达成绩归属情况。保研人数 `recommended_count = student_count - exam_count`。展示招生构成时一起列出同年、同范围的总人数、考研人数、保研人数，例如“2026年共4人，考研1人，保研3人”；不只写“以保研为主”。占比为人数除以名册人数的百分数（0–100）。名册为零时占比为 null，筛“只有考研”必须加 `student_count>0`，不能把无样本导师算进去。

```sh
# 全部只有考研学生的导师：可继续管道、分组统计或可视化
node bin/mentor.mjs query --from mentors --where '[{"field":"student_count","op":"gt","value":0},{"field":"recommended_count","op":"eq","value":0}]' --select name,student_count,exam_count,recommended_count,exam_ratio
```

## 评价洞察字段

`mentors` 与 `search` 结果额外包含由评价归纳出的字段（基于脱敏转译评价）：

| 字段 | 含义 |
| --- | --- |
| `green_flags` | 优点标签，如“可以实习、不打卡、尊重学生、补助 ¥2000/月” |
| `red_flags` | 风险标签，如“压榨记录、会骂人、限制实习、非本人带教、整体不推荐” |
| `watch_flags` | 注意事项，如“有条件实习、论文要求高、偏工程、可带博士” |
| `actual_supervisor` | 评价写明的日常带教导师（须为已收录导师），否则为 null |

标签可直接用 `contains` / `not_null` 筛选；具体主体、条件与例外以 `review_text`、`management`、`internship` 等完整评价记录为准。负面评价按原样保留。本机服务另有 `GET /api/insights` 返回每位导师的标签依据语句、六维培养画像与证据强度。

## 统一表结果

```json
{
  "ref": "t1",
  "rows": [{"name": "某导师", "rating": 4}],
  "columns": [{"key": "name", "label": "导师", "type": "string"}],
  "total": 33,
  "returned": 1,
  "offset": 0,
  "next_offset": 1,
  "sources": [{"id": "S1", "title": "2026 招生信息与导师评价"}],
  "notes": ["ref 仅包含本次返回的行"]
}
```

- `total` 是分页前行数，`returned` 是本次行数。**ref 只包含实际返回的行。**
- Agent/HTTP 默认每次 30 行，CLI 默认 5000 行；最大 5000 行。需要全体统计时直接 `aggregate` 原数据集。
- CLI 中 `--from -` 或 `--left -` 读取上一条命令的表结果。若输入是截断分页，拒绝继续统计，避免把样本当总体。
- 内置 Agent 的 ref 随对话保存；独立 HTTP 工具的 ref 只在该服务进程存活期间有效；CLI 通过 JSON 管道传递行，不依赖另一进程的 ref。
- 数据更新后，旧对话的模型资料快照、摘要和内部 ref 自动失效；后续查询读取当前数据。历史消息和已展示图表仍可回看，不能用旧结果代替当前统计。
- 未知工具、未知字段、无效参数和不支持的额外参数都会明确报错，不静默忽略。
- 内置 Agent 对很长的原文结果只发送受限正文预览，并提供 `model_preview` 说明。完整 ref、界面和 HTTP/CLI 结果不变；模型可继续按候选筛选或选列读取，减少重复全文的 Token 消耗。

## catalog

```json
{}
```

返回所有数据集的字段、类型、数量及来源。可用 `{"dataset":"exams"}` 只查看一个。

## search

```json
{
  "terms":["AI security"],
  "filters":[{"field":"can_supervise_doctoral","op":"eq","value":true}],
  "limit":100
}
```

跨个人方向、培养资料、官网简介与成果、团队方向和分工检索。`terms` 默认按或匹配；`mode:"all"` 要求每个主题都命中。支持 AI security／人工智能安全、大模型安全／LLM security、网络安全／网安等同义表达与子方向召回；大模型安全检索不会扩展为泛 AI。支持常见同音异写姓氏检索（如傅/付、肖/萧），并在 `query`/`visualize` 精确筛选未命中时提示已收录同音姓名。`query.contains` 仍为字面筛选。

横向、纵向等培养路线还按相关表述召回：工程实践、校企合作、项目与经费资源、学术偏好及理论研究等。`matched_topics` 显示实际命中原词，资源和培养方式按实际内容介绍，明确的项目资助类别使用原文记载。单独检索“国家自然科学基金”仍保持该词的匹配。分别比较两条路线用默认 `any` 取并集，再分类选人；`all` 用于同时满足两条路线的候选。

读博、深造、学术训练、PhD等培养目标按科研培养、博士指导与学术成果相关表述召回；就业、找工作、只读硕士等培养目标按实习放行、考勤自由度、毕业要求与工程项目资源召回，并剔除否定语境误命中。

返回原导师字段及 `matched_topics`（实际命中主题）、`topic_basis`（个人／团队依据）、`topic_evidence`（命中资料与相关职责）。以下综合字段在 `mentors` 与搜索结果中均可读取，按稳定身份关联，原数据文件不因查询而改写：

| 字段 | 内容 |
| --- | --- |
| `rating` | 原评价的培养体验评分，与学术成果分别比较 |
| `academic_summary` | 从公开履历、项目成果与培养资料提取的职称、团队管理职责、代表性科研项目/论文与培养定位概览 |
| `research_evidence` | 个人、适用团队及网页中科研培养、项目平台、论文与成果相关的语句 |
| `profile_evidence` | 官网与第三方公开介绍中的研究领域、简介、项目、成果和指导学科，保留资料类别 |
| `training_evidence` | 完整个人培养与适用团队记录、公开项目资料 |
| `can_supervise_doctoral` | 导师类别或明确博士指导学科支持的资格；未记载时为null |
| `doctoral_evidence` | 对应的博士指导依据；博士学历本身不作为资格 |
| `group_lead` | 资料明确的组内管理职责；不生成学术分数 |

例如 `query` 可直接选择 `name,college,rating,research_evidence,profile_evidence,can_supervise_doctoral`，随后将同一ref交给筛选、关联或可视化。评价目录仍为414条；仅有公开网页的其他候选继续从搜索ref使用。

支持与 query 相同的 `filters,select,sort,sort_by,order,limit,offset`，结果 ref 可继续 query、join、aggregate 和 visualize。CLI与HTTP保留完整结果，内置模型预览保留本页全部姓名、评分与资格，并按所选模型容量分配长资料预算。1M模型可读取更完整的科研资料，小容量模型可继续从ref分批读取。来源预览保留编号、标题和类别，具体链接与日期仍在完整结果中。

## query

```json
{
  "from": "mentors",
  "filters": [
    {"field":"rating","op":"between","value":[4,5]},
    {"field":"college","op":"in","value":["网络空间安全学院"]}
  ],
  "select": ["mentor_id","name","rating","internship","management","group_context"],
  "sort_by": "rating",
  "order": "desc",
  "limit": 100
}
```

所有条件为 AND。支持 `eq,ne,gt,gte,lt,lte,between,in,not_in,contains,not_contains,is_null,not_null`。`between` 包含两端；`in` 用于多选学院、导师、专业等；`contains` 对字符串大小写不敏感，对数组判断元素。

`null` 不参与数值比较，排序始终置于末尾。学生反查导师只需 `students` 按 `student_id` 筛选；导师的学生只需按 `mentor_id` 或 `mentor_name` 筛选。这里的学生 ID 是匿名标识，原始学号没有公开查询接口。

### 有序名单与推荐编号

IN只筛选行，不保留输入名单的先后。确定推荐顺序后，可用`sort:[{field:"mentor_id",values:["首选ID","第二名ID"]}]`，默认按values顺序；未列出的值置后。再设`row_number_as:"推荐序"`，排序后、分页前从1编号；本次生成列会自动加入输出，不会因select遗漏而消失，列元数据包含`role:"ordinal"`。编号不替代考试成绩中同分同名次的rank_first字段。CLI支持`--row-number 推荐序`。

### 计算列与联合排序

`derive` 按顺序生成数值列，随后再筛选、排序、投影及分页。表达式是数值、字段名或前缀数组，支持 `+ - * / abs sqrt round min max coalesce`，不执行代码。空值参与运算得到 null；除以零得到 null。`round` 的第二个参数是可选小数位数。可引用前面生成的列，不能覆盖已有列；原有统计范围会传递到计算列。

```json
{
  "from":"t4",
  "derive":[{"as":"分差","expr":["abs",["-","score_first",350]]}],
  "sort":[{"field":"分差","order":"asc"},{"field":"rating","order":"desc"}],
  "select":["mentor_name","score_first","rating","分差"],
  "limit":10
}
```

上游 `t4` 应先完成用户要求的专业、拟录取及关联筛选。多字段 `sort` 优先于单字段 `sort_by/order`；null 在每一级排序都排在末尾。CLI 也支持 `--derive '<JSON>'` 和 `--sort '<JSON>'`。

## aggregate

```json
{
  "from":"exams",
  "filters":[{"field":"admitted","op":"eq","value":true}],
  "group_by":["program"],
  "metrics":[
    {"op":"count","as":"样本数"},
    {"op":"mean","field":"score_first","as":"初试均分"},
    {"op":"median","field":"score_first","as":"初试中位分"},
    {"op":"quantile","field":"score_first","q":0.25,"as":"下四分位"}
  ]
}
```

支持 `count,mean,median,min,max,sum,quantile,stddev,correlation,values`。`values` 将指定字段的非空值按输入顺序收集为列表，保留重复值，可直接用于表格；例如 `{"op":"values","field":"score_first","as":"对应初试分数"}`。`count` 无字段统计全部行，带字段只数非空值；除values外的其余指标只接受数值且忽略 null，空样本结果为 null。分位数使用排序后的线性插值，结果保留三位小数。`stddev` 是样本标准差（分母 n−1）；`correlation` 是皮尔逊系数，需同时提供 `field` 与 `with`。只使用两个字段都为非空数值的配对样本；不足两个样本或零方差时结果为 null，不能当作零相关。

```json
{"from":"exams","group_by":["program"],"metrics":[{"op":"count","as":"样本数"},{"op":"correlation","field":"score_first","with":"score_reexam","as":"相关系数"}]}
```

直方图增加 `"bucket":{"field":"score_first","width":10}`，结果中 `bucket` 是区间起点，**左闭右开**。建议按 `bucket` 升序排列。

`score_reexam` 是复试分，`score_total` 是原表的加权总成绩。业务课一、业务课二保留原表字段，不凭空断言具体考试科目。

## join

```json
{
  "left":"t1",
  "right":"mentors",
  "left_on":"mentor_id",
  "right_on":"mentor_id",
  "how":"inner",
  "select":["mentor_name","program","样本数","rating","internship"],
  "limit":100
}
```

仅等值关联，支持 `inner` 和 `left`。空键不匹配。右表重名列加 `right_` 前缀；一对多关联保留所有匹配行，因此统计前要检查粒度。

## visualize

```json
{
  "from":"t2",
  "type":"bar",
  "x":"mentor_name",
  "y":["样本数"],
  "title":"335–365 分历史拟录取样本的导师去向",
  "description":"2026年网安学院335–365分已关联导师的拟录取样本。"
}
```

`row_notes`优先使用唯一字段关联说明，排序后仍属于对应记录，例如`{"by":"name","entries":[{"value":"付俊松","text":"本人直接指导，研二下实习"}]}`。`by`字段须保留在`select`中，字段值须唯一，每条记录对应一次说明；同名时使用`mentor_id`，展示层会隐藏内部ID。旧字符串数组保留兼容，内置Agent使用键关联格式。注解不回写查询ref，不替代实际数值与来源。

`purpose`可选`recommendation`（推荐名单）、`comparison`（条件对照）、`statistics`（样本统计）。纯聚合结果省略此项时自动按统计展示；统计序号不会被当作导师推荐名次。聚合结果的分组列和指标列分别带`dimension`与`statistic`角色，查询、管道和关联继续保留。

统计图的`from`使用已有结果ref；先用query准备数据，或用aggregate完成统计。表格还可直接读取原数据集，使用`pick`按唯一字段值选择真实记录并保留顺序，内部复用相同查询内核。不会接受模型自填行数据。`select`精选业务列；内部ID与文件定位始终排除。

```json
{"from":"mentors","type":"table","title":"就业与项目","pick":{"field":"name","values":["付俊松","杨正球"]},"row_number_as":"推荐序","select":["name","college","rating","review_text","internship","graduation"]}
```

找不到的值或不能唯一定位的同名会返回具体错误，同名时使用mentor_id。`row_number_as`会自动保留在展示中。生成结果返回`artifact.id`；后续visualize传入`replace:原图id`可更新这一张图，其他分类保留，不需要重做全部结果。

仅传`{"discard":"原图id"}`可移除多余展示项，返回`discarded`信号，由聊天Agent或调用方移除该图；原查询ref继续可用。资料核对使用query，补充人选并入原主表后更新replace，无需另建核对表。

导师排名默认以紧凑名单展示，支持展开完整评价记录、表内查找、分页、切换表格与CSV；多类排名使用标签切换，合计人数按不同导师计算。来源默认折叠，点击可继续查阅具体材料。复制和导出保留完整结果。

支持 `bar,line,scatter,table,metric`。数值图表接受 1–4 个 y 字段，最多 5000 行；柱状图界面先展示前 20 行并明确标注，全部行可在数据视图查看。文字分类柱状图横向排列以便阅读姓名，数值分桶纵向绘制，保留数值间距。`table` 不需要 x/y；`metric` 只需要 y，x 可选用于给指标添加分类名称。图表不会把缺失值画成 0。返回的 artifact 与查询字段、行、来源一致。散点可设置 `color_by`：分类字段生成图例，数值字段使用连续色阶；悬停详情取自查询中保留的业务列。标题中的导师人数须与实际唯一姓名数一致；限定专业的标题不能误用全专业汇总列。

## CLI 管道

```sh
# 得到相近分数的唯一关联样本，然后统计每位导师的人数。
node bin/mentor.mjs query --from exams --where '[{"field":"score_first","op":"between","value":[335,365]},{"field":"admitted","op":"eq","value":true},{"field":"match_status","op":"eq","value":"unique"}]' --select mentor_id,mentor_name,score_first |
  node bin/mentor.mjs aggregate --from - --group-by mentor_id,mentor_name --metrics '[{"op":"count","as":"样本数"},{"op":"median","field":"score_first","as":"初试中位分"}]' |
  node bin/mentor.mjs join --left - --right mentors --left-on mentor_id --right-on mentor_id --select mentor_name,样本数,初试中位分,rating,internship
```

所有工具都支持 `--json '<完整工具参数>'`。成功时只输出 JSON 到 stdout；失败时 JSON 错误写到 stderr，退出码 1。

## HTTP

```sh
curl http://127.0.0.1:3210/api/tools
curl -X POST http://127.0.0.1:3210/api/tools/query -H 'Content-Type: application/json' -d '{"from":"mentors","select":["name","rating"],"limit":5}'
```

服务提供：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health`, `/api/data`, `/api/tools` | 健康、数据概况和工具 Schema |
| POST | `/api/tools/:name` | 执行同名工具，参数为工具 JSON |
| GET / PUT | `/api/config` | 读取脱敏配置 / 检测并保存连接 |
| PUT | `/api/config/execution` | 保存 `reasoningEffort` 和 `compressionThresholdTokens`；null阈值表示自动管理 |
| GET / POST | `/api/models` | 读取当前连接的模型列表 / 检测给定 URL、Key 的模型列表；包含服务商声明的容量信息 |
| PUT | `/api/config/model` | `{ "model": "模型 ID" }`；选择并保存列表中的模型 |
| GET | `/api/usage` | 累计用量与最近请求 |
| GET / POST | `/api/chats` | 列表 / 创建对话；GET 支持 q 搜索正文和可见表格，deleted=1 读取回收站 |
| GET / PATCH / DELETE | `/api/chats/:id` | 读取 / 重命名（title）/ 移到回收站 |
| POST | `/api/chats/:id/restore` | 从回收站恢复原对话，保留消息与图表 |
| POST | `/api/chats/:id/messages` | `{ "text": "问题" }`；返回 SSE |
| POST | `/api/chats/:id/cancel` | 停止当前生成，保留部分回答 |
| GET | `/api/chats/:id/events` | 接续已有后台执行的 SSE，并先发送当前快照 |
| POST | `/api/chats/:id/retry` | 重新生成最后一条回答，不重复用户问题；成功后替换旧答复，失败或停止保留旧内容；返回202快照后接续events |

SSE 事件：`start,sync,progress,context,tool_start,tool_end,artifact,delta,usage,done,error`。`sync` 为接续快照；`progress` 是实际处理步骤；`context` 报告自动压缩次数。准备阶段只在本地检查名单人数、名次列与明确的名册数字，最多修正一次，不调用额外模型裁判主观推荐。图表随正式回答交付；失败或停止时保留已有内容。`done` 表示本次回答完成。每次真实模型请求都计入用量，包括工具往返、上下文压缩和正式回答生成；没有usage的请求标记为未计量。

`delta.content` 是经过展示处理的完整当前正文，客户端优先使用它；`text` 是可安全追加的片段。已经显示的文字不会回撤。聊天中的工具步骤仅提供 `id,label,status,summary`，不包含内部名称、参数或原始返回值。

## 普通对话与上下文

所有问题通过`/messages`直接完成。页面不再提供目标模式，后台不自动续跑历史目标。旧消息前的`/goal`按普通问题兼容读取，旧的`goal/resume`接口返回410。

相同参数的成功查询在单次回答中复用原结果引用，连续重复查询会进入整理交付。短暂网络故障可重连一次；失败回答由用户直接点击“重试”。浏览器刷新可接续当前后台请求，服务重启后保留未完成状态，不擅自重新消耗模型用量。旧目标记录仅留在本机历史档案中，不参与新执行。

上下文容量优先读取服务商 `/models` 的 `context_window` 与 `max_output_tokens`。未知容量时使用保守阈值；也可用 `MENTOR_CONTEXT_TOKENS` 明确覆盖容量。接近阈值时压缩旧历史，保留最新指令和完整的 assistant/tool 协议组；确实超限时降低预算再压缩重试。完整表结果、图表和可见历史不删除，查询 ref 继续可用。压缩请求在用量中标记为 `purpose: "compaction"`。


## 执行参数

`reasoningEffort` 可选值以 `/api/config.reasoningOptions` 为准，不臆造服务商档位。DeepSeek关闭模式发送 `thinking.type=disabled`；指定档位时发送 `thinking.type=enabled` 及对应 `reasoning_effort`；跟随模型不指定强度。推理历史保留在后端工具协议中，不进入公开消息；压缩只保留任务事实，不复制推理正文。

`compressionThresholdTokens` 是输入上下文的触发Token数，null使用自动阈值。可用范围由 `compressionMinTokens`、`compressionMaxTokens` 给出，实际触发点为 `compressionTriggerTokens`。为输出保留空间；容量未知时明确标记为估算。后台会缩减保留历史以符合用户阈值，仍超限时继续收紧预算并重试。

具名展示时，若之前的选列省略了导师静态字段，`visualize`可从已存的完整结果按同一记录补齐；原查询投影保持不变，`pick`的人选与顺序保持不变。补齐需要唯一身份和已有事实完全对应，不扩大名单，也不借用其他计算结果。

## 择导画像工具

`profile` 读写用户长期偏好，内置 Agent 每轮自动读取：

```json
{"action":"update","stage":"exam","goal":"career","score":352,"program":"085412","musts":["internship","no_clock"],"interests":"漏洞挖掘"}
```

`stage`：exam / recommended / doctoral；`goal`：career / research / undecided；`musts`：internship、no_clock、stipend、personal、no_paper、kind、doctoral、resources。只传变化字段；`{"action":"read"}` 读取。HTTP：`GET/PUT/DELETE /api/profile`，或 `POST /api/tools/profile`。

## 个人工作台工具

`workspace` 与六个纯数据工具分开：连接正在运行的本机服务，读写用户的候选、备注、比较、清单、动态视图、模板和方案。普通数据 CLI 仍可独立运行。HTTP 与内置 Agent 共用 `createWorkbench()`，服务端按分析功能的程度检查权限；不按会员档位限制收藏或比较人数。

```sh
# 实际查询结果直接收藏；导师按姓名与学院解析，不跨进程传临时ref
node bin/mentor.mjs query --from mentors --where '[{"field":"college","op":"eq","value":"软件学院"},{"field":"rating","op":"gte","value":4}]' --select name,college |
  node bin/mentor.mjs workspace --action save --from -

# 读回候选表，可以继续标准管道
node bin/mentor.mjs workspace --action read --limit 1000 |
  node bin/mentor.mjs aggregate --from - --group-by college --metrics '[{"op":"count","as":"候选数"}]'

# 私人备注只有明确指定时读取
node bin/mentor.mjs workspace --action read --include-notes

# 使用当前工作台名单生成真实报告文件，返回file元数据
node bin/mentor.mjs workspace --action report --format html --name '本轮导师比较'
```

默认连接 `http://127.0.0.1:3210`，可用 `--server` 或 `MENTOR_SERVER_URL` 指定。复杂参数用 `--json`，完整定义由 `schemas` 返回。消费标准输入时必须包含完整 rows，不能把分页样本静默当成整份名单。

`POST /api/tools/workspace` 接受同一工具参数。`read` 返回的 ref 只含本页；`analyze` 使用已收藏人选和共享 filters 语义，得到的表可继续 query / visualize。`scenario` 按两份实际方案 ID 返回共同、增减与保存资料差异，维度增减单独表达。

`report` 在私有目录保存实际文件，返回 `file.id/name/format/depth/count/createdAt`；`GET /api/workbench/reports/:id` 下载原文件。聊天消息只携带文件元数据，刷新与体验切换不重新生成内容。基础事实、联系进度、非空备注及真实来源保留，进阶档位增加概览、图表及已有方案结论。已有文件不因档位变化失效。

界面使用 `/api/workbench` 读取完整状态，`/comparison` 的 PUT 替换名单、PATCH 增减人选；其余条目、清单、视图、模板与方案接口均属于私有本机工作区。不同学院同名导师分别存储。实际会员与所有者权限由本机私有配置决定，体验切换只改变当前分析功能，不改实际等级。

### 读取当前对比与载入保存项

`workspace read` 默认范围是收藏库；`--scope comparison` 或 JSON 中的 `scope:"comparison"` 读取当前对比，保持对比顺序，也包含未收藏的人选。返回的 `comparison` 始终描述当前名单、目标和维度，读取不改变名单。

`read` 返回的 `snapshots/templates` 提供保存项元数据；`restore` 使用 `saved_type:"snapshot"|"template"` 和实际 `saved_id` 载入。方案恢复名单、维度和目标；模板恢复维度和目标，保留当前名单；两者均保留最新个人备注与联系进度。

`report` 默认直接使用当前对比，明确 `scope:"library"` 才导出收藏库。`from/mentors` 仍可显式指定其他报告人选，来源于实际查询结果。详见[4.0.1 使用走查](USABILITY-4.0.1.md)。

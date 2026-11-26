# 数据说明

当前资料覆盖网络空间安全学院、计算机学院、软件学院、人工智能学院，共414位导师、309条个人和组内评价。2026年网安名册包含376条学生记录，初复试样本为158人。网页介绍另存，现有1245条，覆盖全校14个学院。

## 评价与评分

2026-11-15完成全部评价改写。研究方向、指导分工、师生相处、项目、补助、考勤、假期、实习、论文、毕业以及具体经历按现有内容完整整理；没有记载的项目直接省略。不同学院同名导师、个人评价和共同培养安排分别关联。个人明确安排优先，例如付俊松、杨文川自行带教，郭燕慧按自己的考勤和实习安排介绍。

评分表示综合培养体验，分数越高体验越好：5分为正面体验突出，4分为良好，3分为利弊并存或一般工作负担，2分为明显的指导、管理或相处问题，1分为整体明确不推荐或严重培养问题。评分结合完整文字校准，共调整54位导师；各导师与其关联评价采用同一分数。学术实力、研究方向、项目资源继续按具体记录比较。

仓库 `data/` 目录仅保留加密封存后的 `.vault` 二进制数据包，可编辑的明文工作副本仅保留在本机 `.local/plaintext-data/*.json`（已列入 `.gitignore`，不会提交到 Git）：

- `data/dataset.vault`（本地副本 `.local/plaintext-data/dataset.json`）：131位网安导师、81条评价、学生和考试数据，以及专业目录、评分标准。
- `data/pdf-reviews.vault`（本地副本 `.local/plaintext-data/pdf-reviews.json`）：283位其他学院导师及228条改写后的评价。沿用文件名和记录ID，原PDF页面正文已移除。
- `data/mentor-notes.vault`（本地副本 `.local/plaintext-data/mentor-notes.json`）：付俊松的研究方向、本人指导、生源和招生安排，归为第三方评价。

原PDF的来源编号、页数和文件指纹保留为出处元数据。旧评价正文、旧PDF转录、原件、重复数据及旧发行包清理后，只使用当前版本。当前姓名异写保留各自记录，包括邱朋飞/邱鹏飞、周亚建/周亚健、王晨宇/王晨雨。

## 评价洞察（风险与优点标签）

`lib/insights.js` 在运行时把每位导师的个人评价、管理、实习、毕业、补助与适用的团队资料逐句归纳为标签和六维培养画像；全部导师评价均经过语义脱敏转译，保留核心培养事实：

- 风险标签：限制实习、打卡坐班、非本人带教、压榨记录、会骂人、整体不推荐、加班较多、补助偏低、毕业风险、情绪化、低口碑。
- 优点标签：可以实习、不打卡、时间自由、不卡论文、亲自指导、尊重学生、资源充足、去向不错、正常放假、高补助。
- 注意事项：有条件实习、论文要求高、偏学术、偏工程、可能出差、可带博士。

每个标签均附带触发它的评价依据语句；个人记录优先于团队默认，团队来源单独标注。缺少记录的画像维度为空，不按低分处理。学生补助只采用整理后的月补助数值字段，自由文本中的公司付款或项目奖金不计入。负面评价按学校要求全部保留并如实展示。

## 更新

如需更新数据，请编辑本机 `.local/plaintext-data/*.json` 中的评价和相关字段，再执行 `npm run data:seal`（即 `node scripts/seal-data.mjs`）重新封存为 `data/*.vault`。`npm run data:build` 读取 `.local/plaintext-data/dataset.json`（缺失时自动在内存中解密 `data/dataset.vault`），仅根据原有学生输入重建成绩、名册关联和统计，沿用当前已整理的导师评价、方向及评分，将结果写入 `.local/plaintext-data/dataset.json` 并自动更新 `data/dataset.vault`（不会向 `data/` 写入任何明文 JSON）。

新PDF可先安装Python和`scripts/requirements-pdf.txt`中的依赖，再使用`npm run data:import`提取。脚本从 `.local/plaintext-data/*.json` 或内存解密的 `data/*.vault` 读取元信息；已有规范化评价时，结果写入`.local/pdf-import/pending.json`，否则写入 `.local/plaintext-data/pdf-reviews.json` 并自动更新 `data/pdf-reviews.vault`。应用在运行时通过 `lib/vault.js` 与 `lib/data.js` 在内存中解密读取 `data/*.vault`，Mac 和 Windows 均开箱即用且无需安装 Python 或 PDF 解析依赖。

## 官网与第三方介绍

`data/web-profiles.vault`（本地副本 `.local/plaintext-data/web-profiles.json`）保存已抓取的公开主页，包含职称、方向、简介、公开邮箱、指导专业、项目和成果。每页保留URL、发布机构、来源类别、抓取日期和页面明示的发布日期。姓名与学院共同确定关联，已有明确关联保持原ID。

`npm run data:crawl`读取北邮研究生院公开招生目录及`data/web-seeds.vault`（或 `.local/plaintext-data/web-seeds.json`）中的补充入口。抓取结果保留各来源已有的实际介绍，不覆盖当前培养评价和评分，输出写回 `.local/plaintext-data/web-profiles.json` 并自动更新 `data/web-profiles.vault`。新增、更新网页后重启服务即可使用。

## 数据加密与密钥管理（Polaris Vault）

`data/` 目录下的 5 个数据集（`dataset.vault`、`pdf-reviews.vault`、`mentor-notes.vault`、`web-profiles.vault`、`web-seeds.vault`）全部采用 **PVLT v2** 格式加密封存（Brotli 压缩 + `scrypt` 密钥派生 + `AES-256-GCM` 认证加密 + 运行时调用栈与单次领取 `Symbol()` 能力封印）。

- **开源仓库开箱即用（内置项目绑定解密）**：从 GitHub 克隆仓库后无需额外配置 `.env` 或 `.local/vault.key`，通过北极星项目内置运行命令（`npm start`、`npm run launch`、`npm run cli` 等）即可在内存中自动派生项目绑定密钥并正常解密读取 `data/*.vault`；直接查看仓库中的 `.vault` 二进制文件无法解析出明文内容，未经过 `lib/data.js` 授权边界的外部脚本调用也将被 `ERR_VAULT_UNAUTHORIZED` 拒绝。
- **自定义密钥覆盖（`MENTOR_VAULT_KEY`）**：若需为私有部署设置独立口令，可使用 `node scripts/seal-data.mjs --custom`（读取 `.env` / 环境变量 / `.local/vault.key` 中的 `MENTOR_VAULT_KEY`）或 `node scripts/seal-data.mjs --key <secret>` 封存；向公共开源仓库封存默认使用 `--built-in`（`npm run data:seal`）。若本地存在与 `.vault` 不匹配的 `MENTOR_VAULT_KEY`，服务会严格进入锁定态而不会静默降级。
- **强制锁定与运行时解锁**：设置环境变量 `POLARIS_FORCE_LOCK=1` 可使应用以锁定态启动（`GET /api/health` 返回 `vault_locked: true`，`GET /api/vault/status` 返回 `{ locked: true, mode: "locked", datasets: [...] }`），随后可通过 `POST /api/vault/unlock`（传入 `{ "key": "..." }` 或 `{ "mode": "builtin" }`）在运行时校验密钥、解锁数据并重建查询索引与工作台状态。
- **防明文泄漏与卫生检查**：提交或推送前可运行 `node scripts/check-vault-hygiene.mjs`（支持 `--staged` 与 `--json`），自动审计 `git ls-files`、工作区 `data/` 目录、`PVLT\x02` 二进制头、防明文泄漏扫描、内置解密合约以及受控源码密钥扫描。

## 学生与成绩

初复试按原始考生编号关联；仅专业和脱敏姓名唯一对应的拟录取学生关联导师。158人中137人拟录取，118条与名册唯一关联。名册按项目口径分为118人考研、258人保研：有初试成绩为考研，其余为保研。同批次导师总人数等于考研人数加保研人数。新增学院没有名册时，人数、占比和分数保持空值。

考试排名采用同分同名次的竞赛排名，同时提供总体与专业内排名；统计忽略空值。科目名称沿用政治、外国语、业务课一、业务课二。劳务数值保留原有明确月记录端点，年级、奖金和条件由支付文字完整表达。

学生与考生使用随机匿名标识。本机`.local/student-names.json`支持实际姓名显示，`.local/private-id-map.json`保留导入标识映射；学生姓名、原始学号、私人联系方式、原始学生文档、本机配置及对话均不进入源码包。自定义`MENTOR_DATA_FILE`使用自身数据。

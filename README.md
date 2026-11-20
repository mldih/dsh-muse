# Muse · 学习科研助理

> 一个 **DSH 插件**：把学习与科研进度变成可执行、跨会话的状态；记忆条目按时间直读，人格与画像实时注入每一次模型调用。

## 功能

- **固定记忆库**：首次启用自动探测宿主（`DSH_HOME` → `DSHM_HOME` → `MUSE_HOME` → XDG → HOME → 工作区），写入 `host.json` 锚点；之后始终复用同一目录，不随会话工作区变化。
- **记忆直读**：新建记忆写入 `memories/`，面板按时间**从最近到之前**直接展示标题、时间与内容，不列目录、不显示任何本机路径。核心起始文件（画像/人格/计划/台账/文献/容量等）不出现在记忆列表里。
- **画像可自写、AI 持续更新**：页面编辑能力等级、兴趣、摘要、概念熟悉度；采集计数与证据自动累积。保存后**无需重启**，下一次模型调用立即使用新画像。
- **人格实时生效**：名字、语气、讲解深度、语言、表达风格、自定义要求；经 `systemPrompt` 注入每次调用，保存后立即生效。
- **强制接入模型流**：包装 `llm/stream`，原样透传每个块，旁路采集思考（`reasoning-delta`）与正文（`text-delta`），写入 `conversations.log`；采集异常绝不影响模型。
- **容量可控**：默认 1 GiB；面板提供「有限额 / 无上限」二选一。选无上限时输入框不可编辑；选有限额时可输入数值并选择单位 **B / KB / MB / GB / TB**。超限自动压缩、归档、轮转与删除较旧内容。
- **三态台账**：`done / missing / unknown`；同类未知 ≥3 时输出带具体缺口与追问的提醒。
- **论文与统计**：精读必答清单（按画像调深度）、统计检验推荐 + Python 实现、可复现性检查。
- **文献核验**：真查 Crossref / PubMed，标题重合度达标才 `verified` 并入库；查不到如实列出，不编 DOI。
- **研究梳理**：大纲、初稿骨架（`draft.md`）、投稿前润色自检。
- **启发**：上手路径、复现路线、延伸方向。

## 界面

- **左侧栏图标列**：`Muse` 图标 → 主面板。
- **主面板**（从上到下）：
  1. 顶部标题 **Muse**，下方副标题「你的科研学习助手」；
  2. 横栏三个选择条幅 —— **记忆 / 人格 / 计划**：未选中段为淡灰底，选中段完全透明（仅加粗）；
  3. 下方内容区独立上下滚动。
  - 记忆：存储上限（有限额/无上限、B/KB/MB/GB/TB 单位）+ 记忆库条目（按时间倒序、直接显示内容）+ 用户画像。
  - 人格：说话方式与表达风格。
  - 计划：学习/科研计划 + 三态台账。
- **设置左侧导航**：`Muse` 设置页（人格、存储上限、说明）。
- 顶部没有渐变徽标，也不显示宿主名、记忆库路径或版本字样。

## 安装（GitHub 源码）

仓库根就是包根：`package.json`、`lib/`、`cordis.patch.yml`。全部为手写 JS，**不需要构建**。

> 只 `git clone` 到本地不会自动加载；必须安装进 profile 并重启宿主。

### 方式 A：插件页安装（推荐）

设置 → 插件 → 安装插件，填 `github.com/midih/dsh-muse`；安装完成后**重启应用**。

### 方式 B：命令行（DSHM 的 pnpm 安装队列）

```bash
pnpm add github.com/mldih/dsh-muse
```

### 方式 C：手动安装

```bash
git clone http://github.com/mldih/dsh-muse
cp -r dsh-muse "<DSH_HOME>/profiles/<profile>/node_modules/dsh-muse"
```

然后把 `dsh-muse` 加入该 profile `package.json` 的 `dsh.profile.bundles`（本包自带
`dsh.bundle.patch`，安装为 bundle 时会自动插入插件行），或在该 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: dsh-muse
      name: 'dsh-muse'
```

重启宿主（`patchReload: startup`）。

### 安装后自检

- 左侧栏出现 `Muse` 图标，打开后是「Muse / 你的科研学习助手 / 三横栏」；
- 设置左侧导航出现 `Muse`；
- 对话里出现 `muse_*` 工具；
- `GET /dsh-muse/api`（带 `x-muse-client: dsh-muse` 头）返回 `ok`。

> 已通过种子补丁预装过 `dsh-muse` 的设备不要再从 GitHub 安装一次，否则插件行会重复。

## 记忆库结构

```
<dir>/
├── host.json            宿主识别与固定锚点
├── limits.json          容量上限（0 = 无上限）
├── profile.json         用户画像
├── persona.json         人格
├── plan.json            计划
├── ledger.json          三态台账
├── literature.json      已核验文献
├── notes.md / draft.md / overview.md
├── memories/            新建记忆条目（面板只展示这里）
├── conversations.log    思考与正文采集（轮转）
└── compaction-report.json
```

## 工具

| 工具 | 说明 |
|---|---|
| `muse_memory` | `remember` 新建记忆 / `memories` 列出 / `delete-memory` 删除；`init/status/read/write/append/compact` |
| `muse_profile` | `collect` 读全部会话 / `save` / `get` |
| `muse_persona` | `get` / `save` |
| `muse_ledger` | 三态台账增删改查 |
| `muse_plan` | 计划保存 / 读取 |
| `muse_reminder` | 条件化提醒；可生成 `schedule_create` 参数 |
| `muse_literature` | Crossref / PubMed 核验 |
| `muse_analysis` | 论文精读 / 统计方案 |
| `muse_draft` | 大纲 / 初稿 / 润色 |
| `muse_inspire` | 上手 / 复现 / 延伸 |

## 架构

- **宿主** `lib/index.js`：只依赖 Node 内置模块；工具、`systemPrompt` 人格注入、`llm/stream` 采集、`session/event` 画像证据、面板同源 API `/dsh-muse/api`。
- **浏览器** `lib/client.js`：`main` 主面板、`sidebar.panellist` 图标、`settings.section` 与图标；所有读写走宿主 API。
- **API 安全**：仅环回地址 + `x-muse-client: dsh-muse` 头；无 `webServer` 的宿主退化为只读提示。

## 边界

- 不伪造文献、不伪造画像。
- 不承诺离线推送；定时任务由宿主调度工具落地。
- 思考采集只写本机、不上传、不参与模型输入，可删除。
- 缺口检查只作判断辅助，不认定学术不端。
- 界面与数据结构可能继续演进。

## License

MIT

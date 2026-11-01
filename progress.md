# 会话进度

## 当前状态

**最后更新：** 2026-11-01
**当前功能：** v2.0「系统功能结构图」+ 原有陈式 ER 图

## 已完成

- [x] 为现有 sql2er 仓库建立项目级 Agent 指令、功能基线、验证入口和会话交接。
- [x] 将功能清单更新为仓库实际的 SQL/ER、布局、draw.io 和 AI 能力。
- [x] 通过 REA MCP 接管本地 CDP 浏览器，逆向 `https://huahub.com.cn/tools/sql-er` 的 Vite/G6 前端包；确认属性恢复使用 `Xo`：按联系方向分槽、由内向外扫描半径、避让节点与连线，并带逐级降级。
- [x] 重写 `client/core/smart-layout.ts` 的属性排布：25 个属性形成 45–194px 的多层紧凑环；实体轴距改为按自身尺寸计算，允许相邻属性簇嵌合。
- [x] 用空间索引 + 射线投影剪枝将真实 13 表 SQL（167 个属性）的布局耗时从 69s 降到约 200ms。
- [x] 新增 3 项布局测试：25 属性仍紧凑、属性无明显重叠、大表布局确定性。
- [x] 共享模型新增 `AiAttributePatch` / `AiCompletionResult` 与 `appendAttributesToDiagram`：按实体名合并、同名属性跳过、已有主键的实体不再新增主键。
- [x] 后端新增 `POST /api/ai/complete-er`，一次返回联系与属性补丁；提示词要求只补描述中明确提到且现有的属性里没有的属性；保留旧 `/api/ai/generate-relationships` 接口兼容。
- [x] 前端把「AI 补关系」升级为「AI 补全」：一次合并联系和属性，并提示「已补充 X 条联系、Y 个属性」。
- [x] 画布交互：滚轮缩放、右键拖拽平移、左键拖拽节点或框选、Shift 多选、双击改名、Ctrl+Z 撤销；框选多个节点后可整组拖动，拖动实体/联系仍自动带其属性。
- [x] 改名只同步节点名称与尺寸，不重新布局；手动拖拽位置在改名、切换中英文注释时保留。
- [x] 自然语言生成拆成「核心生成」与「全量生成」：全量模式使用独立的「全量生成」系统提示词，单次请求直接产出完整实体、属性与联系，不复用核心生成或补全链路。
- [x] 顶部「访问码」入口改成「模型设置」：可在界面填写接口地址、API Key、模型名与访问码，通过请求头覆盖服务端 env，留空字段回落 env。
- [x] v2.0 通过 REA MCP 逆向 `https://huahub.com.cn/tools/module-diagram`：定位 `FunctionModuleView` 包，确认布局函数按层级分 y、叶子等距排布、父节点居中、最多 8 轮同层防重叠；默认配置为第 0/1 层横排、第 2 层起竖排、同层宽高对齐、层间距 60、节点间距 30、字号 16、直角 1.5px 黑框、无箭头折线。
- [x] 新增 `shared/module-tree.ts`：功能树模型、3 个内置示例（外卖配送平台 / 智能仓储管理系统 / 在线教育系统）、缩进与 Markdown 大纲解析、增删改/拖拽移动、AI 结果规整（最多 6 层、200 节点）。
- [x] 新增 `client/core/module-layout.ts`：复刻参考站布局；系统最小 120×40、模块 100×36、竖排功能 32×32，按本层最长文案统一宽高；竖排逐字堆叠，行高 = 字号 + 4。
- [x] 新增 `ModuleCanvas.vue`：黑白直角框、逐字竖排、水平/垂直居中、父底边 → 水平段 → 子顶边折线、缩放平移、拖拽吸附虚线与 Ctrl+Z。
- [x] 新增 `ModulePanel.vue`：结构树增删改、HTML5 拖拽调整层级/顺序、换一换/恢复示例/清空、大纲粘贴解析、AI 生成。
- [x] 新增 `ModuleToolbar.vue` 与 `stores/module.ts`：适配视图、重新排版、撤销、PNG/SVG/draw.io 导出；树编辑与拖拽偏移统一进撤销历史。
- [x] 新增 `POST /api/ai/generate-module-tree` 与功能树提示词：层级深度由描述决定，单根节点，禁止输出属性/坐标/样式。
- [x] `App.vue` 顶部增加「ER 图 / 功能结构图」模式切换、v2.0 标识；ER 全部入口与逻辑保持不变；FM 标识沿用蓝色主题。
- [x] 版本号升至 2.0.0，更新 README、`feature_list.json` 与本文件。
- [x] 2026-11-01 Edge（Bing 搜索）SEO 优化：
  - `client/index.html` 重写 head：含核心关键词的中文 title/description、`meta keywords`（Bing 官方确认的排名信号）、`robots`、canonical、Open Graph + Twitter Card、schema.org `WebApplication` JSON-LD 结构化数据、`noscript` 降级文案；保留 Bing 验证 meta `msvalidate.01` 占位注释，待站长工具领取后填入。
  - 新增 `client/public/robots.txt`（允许所有爬虫 + 指向 sitemap）与 `client/public/sitemap.xml`（单页站点，priority 1.0）。
  - 新增 `client/public/favicon.svg`（实体矩形-联系菱形-属性椭圆示意图标）并在 head 引用。
  - 2026-11-01 Bing 站长验证码已填入 `msvalidate.01`（`43125117F95CBED0184CB31C96A73B70`），`npm run build` 通过（`dist/index.html` 2.72 kB）；待 push 部署后在 Bing 站长工具完成验证并提交 sitemap。
  - 2026-11-01 收录二次优化（用户反馈提交 sitemap 后仍搜不到）：
    - `meta keywords` 扩充至 20 个：补充实体关系图、E-R图绘制、MySQL ER图、表结构转ER图、ER模型生成器、功能结构图生成器等长尾词与中文变体。
    - `index.html` 的 `#app` 容器内新增静态 SEO 内容（h1 + 功能介绍 + FAQ，含核心关键词）：Bingbot 抓 HTML 时不执行 JS，纯 SPA 之前对爬虫近乎空白；Vue 挂载（`app.mount('#app')`）会替换容器内容，运行时无冲突。产物 `index.html` 由 2.72 kB 增至 4.58 kB。
    - 新增 IndexNow 密钥文件 `client/public/181fe86e648b5acc63db8d05b7651c5a.txt`（Bing 支持的即时推送协议），部署后向 `https://api.indexnow.org/indexnow?url=https://ai-diagram-generator-csp.vercel.app/&key=181fe86e648b5acc63db8d05b7651c5a` 提交一次即可主动通知抓取。
    - `npm run build` 通过，确认密钥文件、robots.txt、sitemap.xml、favicon.svg 均在 `dist/`。

## 验证证据

- [x] `npm run typecheck` — 通过。
- [x] `npm test` — 通过：9 个测试文件、92 项测试；其中 `tests/module-tree.test.ts` 17 项、`tests/module-layout.test.ts` 9 项、`tests/module-drawio.test.ts` 2 项。
- [x] `npm run build` — 通过：Vite production build（2212 modules）。
- [x] 2026-11-01 SEO 改动验证：`npm run typecheck` 通过；`npm test` 通过（9 文件、92 项）；`npm run build` 通过，确认 `dist/` 下 `robots.txt`、`sitemap.xml`、`favicon.svg` 已随 public 目录复制进产物，`dist/index.html` 含新 meta 与 JSON-LD（2.82 kB）。
- [x] 2026-11-01 部署 Vercel（项目 `csps-projects-1abeb98f/ai-diagram-generator`，生产域名 `ai-diagram-generator-mu.vercel.app`）并修复两个线上问题：
  - 修复 1：`@vercel/node` 不会把 `api/` 之外的相对导入打进函数包，`api/[...all].ts` 线上报 `ERR_MODULE_NOT_FOUND`。方案：入口移到 `server/vercel.ts`，新增 `npm run build:api`（esbuild `--bundle --packages=external`）生成自包含的 `api/index.js`（产物需提交进仓库，`functions` 校验发生在 buildCommand 之前）。
  - 修复 2：Vercel 的 catch-all 函数名（`api/[...all].js`）只匹配单段路径，`/api/ai/generate-er` 等多级路径在 Vercel 层 404。方案：函数改固定名 `api/index.js`，`vercel.json` 增加 `rewrites` 把 `/api/(.*)` 转发到 `/api/index`，函数内拿到原始路径，Express 路由不变。
  - 线上验证：`GET /api/health` → 200 JSON；`POST /api/parseSQL` → 200 解析成功；`POST /api/ai/generate-er` → 200 真实大模型生成实体/联系；未知多级路径返回 API 信封 JSON 404。
  - Git push 自动部署已配置（Vercel GitHub App 已授权 `CheShiping/ai-diagram-generator`）。
- [x] 浏览器实测功能结构图模式（http://127.0.0.1:5173）：
  - 顶部显示「系统功能结构图 v2.0」，模式切换选中「功能结构图」；
  - 根节点「外卖配送平台」129.6×40，4 个一级模块统一 100×38，二级功能统一 32×96；
  - 同层宽高一致，文字水平/垂直居中；20 个矩形全部 `stroke=#000000`、`fill=#ffffff`、`stroke-width=1.5`；
  - 左侧结构树显示 20 个节点、4 层，工具栏显示导出入口。
- [x] draw.io 导出单测：竖排文字按 `<br>` 逐字换行、横排不拆字、`endArrow=none`、上下锚点、折线路径点、XML 特殊字符转义。
- [x] 大纲解析单测：缩进四层、Markdown 标题、列表符号、多根合成、空文本报错。
- [x] AI 结果规整单测：`root` / `name+children` / 数组 / `nodes`、空名称过滤、6 层截断、200 节点截断、无有效节点报错、替换整棵树时重新编号避免 id 冲突。

## 当前风险与边界

- 未调用真实大模型；`/api/ai/generate-module-tree` 的结构规整已离线测试，但真实生成质量与端到端请求未验证。
- AI 生成层级由描述决定，服务端强制最多 6 层、200 节点；更深或更大的树会被截断并给出提示。
- 功能结构图的拖拽偏移只保存在当前会话，刷新页面后回到自动布局；结构性编辑（增删改、换示例、AI/大纲替换）会清空手动偏移。
- 改名、增删节点会触发重新布局；如需保留手工位置，可先完成全部拖拽再改名。
- 大纲存在多个顶层节点时会自动归入合成根节点「功能结构」，并显示提示。
- draw.io 的竖排文字用逐字 `<br>` 模拟，和画布上的逐字堆叠视觉效果一致，但不是 draw.io 原生竖排文本。
- ER 侧原有风险仍适用：真实模型未端到端验证、模型配置保存在 localStorage、`.env` 未读取。
- 工作区仍有本功能之前遗留的未提交变更；本次未覆盖或清理无关文件。

## 下一步

1. 配置真实模型后，用一段包含子功能的描述验证 `/api/ai/generate-module-tree` 的端到端生成。
2. 补测浏览器端大纲解析、结构树拖拽排序与画布吸附拖拽（本轮因用户中断未完成）。
3. 如需要，给功能结构图增加样式面板：字号、层间距、节点间距、文字方向与层级配色。

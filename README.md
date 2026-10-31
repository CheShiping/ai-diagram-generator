# sql2er · SQL / 自然语言转陈式 ER 图

把 MySQL 建表语句或一段业务需求，转换成**陈式（Chen）ER 图**：

- **实体** → 矩形
- **属性** → 椭圆（主键加下划线）
- **联系** → 菱形（两端标注基数 `1 / N / M`）

无水印、无付费墙、无登录、无批量导出。整体为黑白线稿风格：白底、黑线、直角矩形，与教科书示例一致。

## 功能

| 输入 | 说明 |
|---|---|
| SQL 建表 | 后端用 `@guanmingchiu/sqlparser-ts`（datafusion-sqlparser-rs 的 WASM 绑定）解析 MySQL AST，提取表名、中文 `COMMENT`、主键、`FOREIGN KEY`（含 `ALTER TABLE ... ADD CONSTRAINT` 形式）。外键列不再重复画成属性；「恰好两个外键、指向两张不同的表、且没有被别的表引用」的关联表会直接画成多对多联系菱形，其余列挂成菱形上的属性 |
| 自然语言 | 后端调用 OpenAI 兼容的 Chat Completions，把需求转成结构化实体/联系 JSON |
| 导入 .drawio | 解析 draw.io 文件（未压缩 XML 与默认的 base64+deflate 压缩格式均可），按形状还原实体/属性/联系、`<u>` 主键与原始排版 |
| AI 补关系 | 基于当前图里的实体，让模型推断缺失的联系并合并进图 |

| 输出 | 说明 |
|---|---|
| draw.io | `.drawio` 可编辑文件，矩形/椭圆/菱形 + 边基数标签，主键用 HTML 下划线 |
| PNG | 2 倍分辨率位图 |
| SVG | 矢量图 |

布局默认 **智能布局**（复刻 huahub）：实体作为 hub，属性填在联系之间的扇形空隙里，联系菱形落在两实体的轴线上，再做物理迭代、交叉最小化与全局松弛。另有 **环形网格**、**力导向**（d3-force）、**分层**（elkjs layered）可切换。从 draw.io 导入后额外提供「导入原位置」，保留文件里的坐标。

## 快速开始

```bash
npm install
cp .env.example .env      # 填入 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
npm run dev               # 同时启动后端(3001) 与前端(5173)
```

打开 http://127.0.0.1:5173 。

> SQL 模式不依赖大模型，`.env` 不填也能用；自然语言模式与 AI 补关系需要配置模型。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | 否 | OpenAI 兼容端点，如 `https://api.deepseek.com/v1` |
| `LLM_API_KEY` | 否 | 对应服务的 API Key |
| `LLM_MODEL` | 否 | 模型名，如 `deepseek-chat` |
| `ACCESS_CODE` | 否 | 设置后所有接口需带 `x-access-code`；前端「访问码」按钮可保存到本地 |
| `RATE_LIMIT_PER_MIN` | 否 | 单 IP 每分钟请求上限，默认 20；填 0 关闭 |
| `PORT` | 否 | 后端端口，默认 3001 |

## API

所有接口统一信封：`{ code, msg?, data, warnings? }`，`code === 0` 表示成功。

```
POST /api/parseSQL                    { sql: string } | { sqls: string[] }
  → data: { tables: ParsedTable[] }

POST /api/ai/generate-er              { prompt: string }
  → data: { entities: [{ name, attributes: [{ name, primaryKey }] }],
            relationships: [{ source, target, type, text, attributes }] }

POST /api/ai/generate-relationships    { entities: [{ name, attributes }] }
  → data: [{ source, target, type, text, attributes }]

GET  /api/health
```

`type` 取值：`oneToOne` | `oneToMany`（source 是 1 端）| `manyToMany`。

```bash
curl -X POST http://127.0.0.1:3001/api/parseSQL \
  -H 'Content-Type: application/json' \
  -d '{"sql":"CREATE TABLE t (id int PRIMARY KEY COMMENT \"编号\") COMMENT=\"表\";"}'
```

## 部署到 Vercel

仓库已带 `vercel.json`，前端静态托管 + `api/[...all].ts` 作为 serverless 入口复用同一个 Express 应用：

```bash
vercel --prod
```

在 Vercel 项目设置里配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`（可选 `ACCESS_CODE`）即可。

注意事项：
- 函数最大执行时长设为 60s（LLM 生成通常 5–30s）。
- 限流基于内存，多实例间不共享，属轻量防护。
- SQL 解析首次调用需加载 WASM，冷启动约几百毫秒。

## 目录结构

```
sql2er/
├── api/[...all].ts        # Vercel serverless 入口
├── server/                # Express + TypeScript
│   ├── app.ts             # 应用装配（本地与 serverless 共用）
│   ├── routes/            # /api/parseSQL、/api/ai/*
│   ├── services/          # sql-parser / ai-client / ai / prompts / rate-limit
│   └── middleware/guard.ts
├── shared/er-model.ts     # 前后端共享：图模型 + SQL/AI → 陈式图转换
├── client/                # Vue 3 + Vite + Pinia + Element Plus
│   ├── components/        # ErCanvas（D3 渲染）/ InputPanel / Toolbar
│   ├── core/              # theme / geometry / layout / smart-layout / export / import
│   ├── stores/diagram.ts
│   └── http/api.ts
├── tests/                 # vitest：解析、转换、draw.io 导入导出
├── vercel.json
└── vite.config.ts
```

## 开发命令

```bash
npm run dev          # 前后端并行
npm run dev:server   # 仅后端
npm run dev:client   # 仅前端
npm test             # 单元测试
npm run typecheck    # 前端 vue-tsc + 后端 tsc
npm run build        # 构建前端到 dist/
```

## 设计说明

- **图模型**统一为 `{ nodes, links }`，SQL 与 AI 两条输入路径都先转换成它再渲染，扩展新输入方式只需产出同样的结构。
- **外键语义**：持外键的一方是「多」端，因此外键被画成 `持有表 --N--> 菱形 --1--> 被引用表`。
- **菱形位置**：网格布局下，联系菱形自动落在两端实体连线的中点；同一对实体的多条联系会垂直错开。
- **ELK 按需加载**，默认的环形网格布局不会下载它。

# Astra Command Center

Astra Command Center 是一个面向内容运营团队的 AI 社媒指挥台，用一套 Web 界面串联账号接入、内容分析、话题推荐和监控告警，适合用于小红书等内容平台的运营观察与策略辅助。

当前仓库已经过一轮轻量整理，核心目标是让读者更容易分清：

- 哪部分是当前正在运行的主 Web 应用
- 哪部分是后端与 Agent 核心逻辑
- 哪部分是归档原型或外部抓取辅助模块

如果你想先看仓库边界说明，可以直接阅读 [docs/repo-structure.md](docs/repo-structure.md)。

## 核心能力

### 多账号同时管理

- 左侧边栏统一展示已接入的监控账号。
- 支持在多个账号之间快速切换查看内容表现。
- 支持删除账号、刷新账号数据，并持续维护账号列表。

### Agent 数据分析及话题推荐

- 在顶部命令栏粘贴小红书主页链接或笔记链接后，系统会触发 Agent 分析链路。
- 分析链路会依次完成抓取、解析、增长评估和策略生成，并可视化展示执行进度。
- 帖子列表支持按点赞、转发、增长率进行排序筛选。
- 点击帖子后，可在右侧策略抽屉查看趋势图、异常信号、推荐动作和话题建议。

### 实时账号监控

- 支持统一刷新所有已接入账号的数据。
- 刷新时会显示任务进度条，便于观察监控状态。
- 系统会识别高增长帖子，并在侧边栏生成异常提醒。
- 当前版本属于刷新驱动的近实时监控，而不是持续推流式监控。

## 当前目录结构

```text
.
├── src/                        # React Web 主应用
├── astramvp/backend/           # FastAPI 后端
├── astramvp/agent/             # Agent 图执行与策略记忆
├── prototypes/vue-command-center/ # 归档的 Vue 原型，不参与当前主构建
├── vendor/xhs/                 # 小红书抓取与存储辅助模块
├── docs/repo-structure.md      # 仓库边界说明
├── scripts/                    # 自动化脚本
├── .github/workflows/          # GitHub Actions
├── requirements-backend.txt    # 后端依赖
└── package.json                # 前端依赖与脚本
```

说明：

- 当前真正运行的前端入口在 [src/main.tsx](src/main.tsx) 和 [src/App.tsx](src/App.tsx)。
- 当前真正运行的后端入口在 [astramvp/backend/main.py](astramvp/backend/main.py)。
- 原来的 Vue 命令中心原型已归档到 [prototypes/vue-command-center](prototypes/vue-command-center)。
- 小红书抓取辅助代码被收口到 [vendor/xhs](vendor/xhs)，根目录保留了兼容导入入口。

## 使用流程

1. 启动前端和后端服务。
2. 打开浏览器访问本地页面。
3. 使用演示账号登录：

```text
账号: brilliantbryant
密码: good123456
```

4. 在顶部输入框中粘贴小红书主页链接或笔记链接。
5. 等待 Agent 流程执行完成，系统会自动更新账号列表和帖子数据。
6. 在左侧切换账号，在中部查看内容表现，在右侧查看策略建议。
7. 点击左上角刷新按钮，可重新拉取所有已接入账号的最新数据。

## 快速开始

### 1. 启动前端

```bash
npm install
npm run dev
```

默认访问地址：

```text
http://localhost:8080
```

前端开发环境默认通过 Vite 代理访问 `/api`，因此本地直连后端时通常不需要额外配置。

如果你的后端不是跑在本机 `127.0.0.1:8000`，可以新建 `.env.local` 并配置代理目标：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

只有在你明确需要绕过本地代理、直连远程后端时，才配置：

```bash
VITE_API_BASE_URL=https://your-api-host/api
```

### 2. 准备后端环境

建议使用虚拟环境：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-backend.txt
```

### 3. 配置后端环境变量

请参考 [.env.example](.env.example) 至少配置以下变量：

```bash
SUPABASE_DB_URL=postgresql+asyncpg://postgres:[YOUR-PASSWORD]@[YOUR-HOST]:5432/postgres
ACCOUNT_TOKEN_VAULT_SECRET=replace-with-a-long-random-secret
REDIS_URL=redis://localhost:6379/0
OPENAI_MODEL=gpt-4o-mini
XHS_STRICT_AUTH=true
```

### 3.5 初始化 Supabase 表结构

当前仓库已经补充了正式迁移文件：

```text
supabase/migrations/20260323143000_init_astra_backend.sql
```

推荐做法：

- 生产 / 共享环境优先通过该迁移初始化 Supabase。
- 本地开发仍可使用后端启动时的 `create_all()` 作为兜底，但不要把它当成正式迁移方案。

当前迁移会创建这些核心表：

- `managed_accounts`
- `account_credentials`
- `agent_sessions`
- `xhs_accounts`
- `xhs_notes`

### 4. 启动 Redis

默认地址：

```text
redis://localhost:6379/0
```

### 5. 启动后端

```bash
uvicorn astramvp.backend.main:app --reload --port 8000
```

前端开发模式默认请求：

```text
/api
```

后端健康检查：

```text
http://localhost:8000/healthz
```

如果你准备把后端部署到云端，请先阅读 [docs/backend-deployment.md](docs/backend-deployment.md)。

## 常用命令

```bash
npm run dev
npm run build
npm run lint
npm test
```

## 后端常用接口

- `GET /api/xhs/accounts`：获取已接入账号列表。
- `GET /api/xhs/accounts/{account_id}/notes`：获取指定账号的帖子列表。
- `POST /api/xhs/notes/ingest`：提交主页链接或笔记链接并触发采集分析。
- `POST /api/xhs/accounts/refresh`：刷新所有已接入账号的缓存内容。
- `GET /api/xhs/auth/status`：查看当前小红书鉴权状态。
- `DELETE /api/xhs/accounts/{account_id}`：删除账号及其缓存内容。

## 技术栈

- 前端：Vite 8、React 18、TypeScript、Tailwind CSS、TanStack Query、Framer Motion、Recharts
- 后端：FastAPI、SQLAlchemy、Redis、Pydantic、asyncpg
- Agent：LangChain、LangGraph、Chroma、OpenAI 模型
- 测试：Vitest、Testing Library、Playwright 配置

## 开发建议

- 新的 Web 页面与交互逻辑，优先放在 `src/`
- 新的 API、Schema、数据写入逻辑，优先放在 `astramvp/backend/`
- 新的 Agent 编排与记忆逻辑，优先放在 `astramvp/agent/`
- 历史原型不要再放回主应用目录，统一归档到 `prototypes/`
- 外部抓取相关的辅助模块，优先归类到 `vendor/`，避免和业务 API 混放

## License

MIT

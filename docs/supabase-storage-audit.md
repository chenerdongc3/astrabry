# Supabase 存储审计

这份清单用来回答一个具体问题: 当前 Astra Command Center 里，哪些数据应该进入后端并落到 Supabase，哪些状态只需要停留在前端或 Redis。

## 已经适合落到 Supabase 的数据

### 1. 监控账号主数据

来源:
- 前端左侧账号列表
- 后端 `GET /api/xhs/accounts`

当前代码位置:
- [astramvp/backend/xhs/models.py](/Users/hb339/astrabry/astramvp/backend/xhs/models.py)
- [astramvp/backend/xhs/store.py](/Users/hb339/astrabry/astramvp/backend/xhs/store.py)

建议落库:
- `xhs_accounts`

原因:
- 账号列表是跨会话、跨刷新都要保留的业务主数据。
- 删除、刷新、重新采集都依赖这张表作为主键锚点。

### 2. 帖子与指标快照

来源:
- 中间帖子列表
- 右侧策略抽屉里的帖子指标
- 后端 `GET /api/xhs/accounts/{account_id}/notes`

当前代码位置:
- [astramvp/backend/xhs/models.py](/Users/hb339/astrabry/astramvp/backend/xhs/models.py)
- [astramvp/backend/xhs/service.py](/Users/hb339/astrabry/astramvp/backend/xhs/service.py)

建议落库:
- `xhs_notes`

原因:
- 点赞、转发、评论、收藏、浏览、增长率都属于核心业务数据。
- 这些数据是刷新后的结果，不应该只存在前端内存里。

### 3. OAuth 受管账号与敏感凭证元数据

来源:
- 后端 OAuth 流程

当前代码位置:
- [astramvp/backend/accounts.py](/Users/hb339/astrabry/astramvp/backend/accounts.py)
- [astramvp/backend/oauth.py](/Users/hb339/astrabry/astramvp/backend/oauth.py)

建议落库:
- `managed_accounts`
- `account_credentials`
- `agent_sessions`

原因:
- 这些是后端会话与账号授权链路的主数据。
- 账号绑定、会话恢复、token 轮换都依赖持久化。

## 现在仍是前端态，但后续应该进入后端的数据

### 1. 登录用户体系

当前状态:
- [src/lib/auth.tsx](/Users/hb339/astrabry/src/lib/auth.tsx) 里是硬编码测试账号。
- 用户状态只保存在 React `useState` 中，刷新页面就丢失。

为什么应该后移:
- 只要开始支持真实团队成员登录，这部分就必须进入后端或 Supabase Auth。
- 否则无法实现多用户、权限、会话续期、审计。

建议方向:
- 优先接 Supabase Auth，前端只保留登录态消费。
- 如果继续走 FastAPI，也至少要有真实用户表和 session/JWT 签发接口。

### 2. AI 策略结果与 Agent 执行历史

当前状态:
- [src/components/StrategyDrawer.tsx](/Users/hb339/astrabry/src/components/StrategyDrawer.tsx) 展示的是按状态映射的静态文案。
- [astramvp/backend/xhs/service.py](/Users/hb339/astrabry/astramvp/backend/xhs/service.py) 虽然会触发 agent，但结果目前只短暂写入 Redis。

为什么应该后移:
- 真实的策略建议、快反建议、异常解释应该是可回看、可比对、可审计的数据。
- 只放 Redis 会在过期后丢失，也没法做历史效果追踪。

建议方向:
- 新增 `xhs_agent_runs` 或 `xhs_note_strategies` 表。
- 记录 `task_id`、`account_id`、`source_note_id`、`strategy`、`fast_responses`、`raw_result`、`created_at`。

### 3. 告警处理状态

当前状态:
- 左侧 `alerts` 由帖子增长率在前端即时计算得出。
- 没有“已读 / 已忽略 / 已跟进”状态。

为什么应该后移:
- 一旦多人协作，告警处理动作必须落库，否则每次刷新都会重置。

建议方向:
- 新增告警表或在策略执行表里附带 `ack_status`、`assigned_to`、`resolved_at`。

## 适合继续保留在前端或临时缓存的数据

### 1. 纯 UI 交互状态

包括:
- 当前选中的账号
- 当前选中的帖子
- 表格排序和筛选
- 抽屉开关
- 刷新进度条
- Agent 动画步骤

原因:
- 这些是当前页面会话内的临时交互状态，不需要跨设备共享。

### 2. 小红书登录 Cookie / 临时 token 缓存

当前状态:
- [astramvp/backend/xhs/service.py](/Users/hb339/astrabry/astramvp/backend/xhs/service.py) 使用 Redis 保存小红书登录态。

建议:
- 继续留在后端，不进入前端。
- 如果需要跨重启保留，可迁到更安全的服务端加密存储，而不是普通前端存储。

## 当前结论

当前项目最值得优先接入 Supabase 的，是这 5 组业务数据:

1. `xhs_accounts`
2. `xhs_notes`
3. `managed_accounts`
4. `account_credentials`
5. `agent_sessions`

其中前两组直接支撑现有页面，后两组和会话链路相关，已经在后端模型中定义，但此前并没有正式落到 Supabase。

## 下一步建议

1. 先把现有 5 张核心表迁移到 Supabase，保证当前 React + FastAPI 流程有真实持久层。
2. 第二阶段再补真实用户登录体系，替换前端硬编码测试账号。
3. 第三阶段把 Agent 结果、告警处理状态也入库，右侧策略抽屉再改成真实后端返回。 

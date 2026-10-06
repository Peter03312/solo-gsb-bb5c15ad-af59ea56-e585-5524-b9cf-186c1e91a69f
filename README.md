# 纪录片字幕校订台（SRT Review）

供纪录片团队校订 SRT 字幕的本地 Web 应用。编辑者基于当前已接受版本提交单条字幕的
**文本 / 起点 / 终点** 修订提议；审校者逐条 **接受 / 驳回**；导出的 SRT
**只包含已接受版本**。系统对每次提议记录作者与所依据版本，依据版本已变化的提议
无法被接受，会明确提示版本冲突并永久保留记录。

- 前端：React 18 + Vite
- 后端：Node.js + Express
- 数据库：SQLite（better-sqlite3，文件持久化）
- 部署：Dockerfile + Docker Compose，一键完成依赖安装、数据初始化与启动

---

## 一、快速开始（Docker，推荐）

前置条件：已安装 Docker 与 Docker Compose v2。

```bash
# 1.（可选）自定义端口、JWT 密钥与初始账号
cp .env.example .env
#   编辑 .env：APP_PORT / JWT_SECRET / 初始账号密码

# 2. 构建并一键启动（首次会构建镜像、安装依赖、建库、初始化账号）
docker compose up -d --build

# 3. 查看状态与日志
docker compose ps
docker compose logs -f
```

启动后浏览器访问：

> **http://localhost:4000** （即 `http://127.0.0.1:${APP_PORT}`，默认端口 4000）

停止 / 重启：

```bash
docker compose stop      # 停止（数据保留在命名卷 srt-data 中）
docker compose down      # 删除容器（数据卷保留）
docker compose down -v   # 删除容器并清除数据库（重新初始化账号）
```

### 默认本地账号

| 角色 | 用户名 | 密码 | 权限 |
| --- | --- | --- | --- |
| 编辑者 | `editor` | `editor123` | 查看原稿与时间轴、提交单条修订提议、导出 SRT |
| 审校者 | `reviewer` | `reviewer123` | 上述全部权限 + 导入 SRT、接受/驳回提议 |

账号仅在数据库 **首次初始化** 时按环境变量创建；users 表已有数据后不会覆盖。
如需改账号/密码，修改 `.env` 后执行 `docker compose down -v && docker compose up -d --build`
（注意：`-v` 会同时清空字幕数据）。

---

## 二、本地开发（不使用 Docker）

要求 Node.js >= 20。

```bash
# 安装依赖
npm run install:all

# 终端 A：启动后端（默认 http://localhost:4000）
npm run dev:server

# 终端 B：启动前端开发服务器（http://localhost:5173，/api 自动代理到 4000）
npm run dev:web
```

开发模式访问地址：

- 前端（带热更新）：**http://localhost:5173**
- 后端 API / 健康检查：**http://localhost:4000/api/health**

生产方式本地运行（先构建前端，由 Express 托管静态文件）：

```bash
npm run build:web
npm start            # 访问 http://localhost:4000
```

运行后端测试（Node 内置测试运行器，9 项端到端用例）：

```bash
npm --prefix server test
```

---

## 三、配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `4000` | Compose 映射到宿主机的端口（容器内固定 4000） |
| `JWT_SECRET` | `please-change-me-in-production` | 登录令牌签名密钥，**生产环境必须修改**，可用 `openssl rand -hex 32` 生成 |
| `DB_PATH` | `server/data/app.db` | SQLite 文件路径；Docker 中为 `/app/server/data/app.db`，由命名卷持久化 |
| `EDITOR_USERNAME` / `EDITOR_PASSWORD` | `editor` / `editor123` | 首次初始化的编辑者账号 |
| `REVIEWER_USERNAME` / `REVIEWER_PASSWORD` | `reviewer` / `reviewer123` | 首次初始化的审校者账号 |
| `PORT` | `4000` | 后端监听端口（本地开发时可改） |

---

## 四、使用流程

1. **审校者登录**，点击「导入 SRT（整批替换）」选择 `.srt` 文件。
   导入会做严格校验（见下），成功后整批替换当前原稿并清空旧提议；
   失败则返回中文错误原因且不改动任何已有数据。
2. **编辑者登录**：列表展示每条字幕的原稿、当前已接受时间轴与版本号（v1、v2…）。
   点击「✏️ 提议修订本条」，可只改文本、只改时间，或两者都改；提交时记录
   **作者** 与 **依据版本（base_version）**。同一条字幕允许同时存在多个待审提议。
3. **审校者** 在每条提议上点「接受」或「驳回」（驳回可填写原因）。
   - 接受：已接受版本更新，版本号 +1；该条字幕上其余待审提议因依据版本过期，
     自动标记为 **版本冲突（conflicted）** 并保留全部记录。
   - 冲突提议：界面以橙色明确提示「依据 vN，当前已更新，不能接受」，
     接受按钮禁用；只能驳回。
4. 任意登录用户点击「导出已接受 SRT」下载 `accepted.srt`，
   内容仅为当前已接受版本（待审/驳回/冲突提议均不会出现），序号按时间顺序重排。

示例字幕见 [`examples/sample.srt`](examples/sample.srt)。

---

## 五、校验规则与错误处理

所有失败均返回 HTTP 4xx 与中文 `{"error": "原因"}`，且**不改变已接受版本**：

- **非法 SRT**：时间码格式错误、超出 `99:59:59,999`、缺文本、起点不早于终点、
  导入批次内部时间轴重叠 —— 逐条指出是第几块/哪两条字幕，整批导入回滚。
- **无权操作**：未登录 `401`；编辑者导入/审校、审校接口被编辑者调用等 `403`。
- **非法修订**：文本为空、起止时间为负或非整数、起点 ≥ 终点 —— 返回 400。
- **时间轴重叠**：提交提议时即预检；接受时再次事务内校验。
  两条区间 `[start, end)` 端点相接允许（如一条 4000 结束、另一条 4000 开始），
  相交则拒绝并指出与第几条字幕重叠。
- **版本冲突**：提议依据版本 ≠ 当前已接受版本时，接受返回 `409`，
  该提议标记为 `conflicted`、写入冲突原因并保留；接受操作不会发生，
  已接受字幕文本与时间轴保持不变。
- 接受 / 驳回均不可重复操作；接受一条提议会使同条其它待审提议立即过期。

---

## 六、HTTP API 摘要

| 方法与路径 | 角色 | 说明 |
| --- | --- | --- |
| `POST /api/auth/login` | 公开 | 用户名密码登录，返回 JWT |
| `GET /api/subtitles` | 登录用户 | 全部已接受字幕（含各自提议与状态） |
| `POST /api/subtitles/import` | 审校者 | `multipart/form-data` 字段 `file` 上传 SRT，整批替换 |
| `GET /api/subtitles/export.srt` | 登录用户 | 下载仅含已接受版本的 SRT |
| `POST /api/subtitles/:id/proposals` | 编辑者 | 提交 `{text?, startMs?, endMs?}` 修订（毫秒整数或 `hh:mm:ss,mmm`） |
| `POST /api/proposals/:id/accept` | 审校者 | 接受提议（冲突/重叠/非法时拒绝并说明原因） |
| `POST /api/proposals/:id/reject` | 审校者 | 驳回提议，可带 `{reason}` |
| `GET /api/health` | 公开 | 健康检查 |

数据模型（SQLite）：

- `users(id, username, password_hash, role[editor|reviewer], display_name)`
- `subtitles(id, seq, text, start_ms, end_ms, version, created_at, updated_at)`
- `proposals(id, subtitle_id, proposer_id, base_version, new_text, new_start_ms, new_end_ms,`
  `status[pending|accepted|rejected|conflicted], conflict_reason, reviewed_by, reviewed_at, created_at)`

---

## 七、目录结构

```
.
├── Dockerfile               # 多阶段构建：前端构建 -> Node 运行时
├── docker-compose.yml       # 一键启动 + 命名卷持久化 + 健康检查
├── .env.example             # 端口 / JWT / 初始账号配置样例
├── examples/sample.srt      # 示例字幕
├── server/                  # Node.js + Express + SQLite 后端
│   ├── src/{index,app,db,auth,srt,validation}.js
│   └── test/api.test.js     # node --test 端到端测试
└── web/                     # React + Vite 前端
    └── src/{App.jsx, api.js, time.js, components/}
```

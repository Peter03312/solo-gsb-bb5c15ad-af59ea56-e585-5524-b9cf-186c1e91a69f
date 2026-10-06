# 字幕校订台（Subtitle Proof）

供纪录片团队协同校订字幕的 Web 应用：导入 SRT 原稿后，**编辑者（editor）**逐条提交文本与起止时间修订，**审校者（reviewer）**逐条接受或驳回；导出的 SRT **只包含已接受版本**。

- 前端：React 18 + Vite
- 后端：Node.js（Express）
- 数据库：SQLite（better-sqlite3，WAL 模式，数据落盘到持久化卷）
- 部署：多阶段 Dockerfile + Docker Compose（自动安装依赖、初始化数据、一键启动）

## 一、快速开始（推荐：Docker Compose）

前置要求：已安装 Docker 与 Docker Compose 插件。

```bash
# 在项目根目录执行
docker compose up -d --build
```

首次启动会自动完成：

1. 构建前端并打包进后端镜像；
2. 在持久化卷中创建 SQLite 数据库与全部数据表；
3. 初始化本地账号；
4. （可选）写入一份示例纪录片字幕，方便直接体验。

启动后浏览器访问：

> **http://localhost:8080**

停止 / 查看日志：

```bash
docker compose down          # 停止（保留数据卷）
docker compose logs -f       # 跟踪日志
```

## 二、内置本地账号

首次启动自动创建（可登录后按需在数据库中扩展）：

| 角色 | 用户名 | 密码 | 权限 |
| --- | --- | --- | --- |
| 编辑者 | `editor` | `editor123` | 导入 SRT、提交单条字幕的文本 / 起止时间修订 |
| 审校者 | `reviewer` | `reviewer123` | 逐条接受 / 驳回修订提议、导入 SRT、导出 SRT |

## 三、工作流与业务规则

1. **导入原稿**：粘贴或选择 `.srt` 文件导入。导入会**整体替换**当前字幕并清空旧修订（界面会二次提示）。
   - SRT 格式非法（时间戳无法解析、缺少文本、起点不早于终点等）→ 拒绝导入并给出具体块号与原因；
   - 文件内部时间轴重叠、负时间 → 拒绝导入；已接受版本不受影响。
2. **展示原稿与当前时间轴**：每条卡片同时显示当前已接受版本（带版本号 v*N*）；若已被修订，下方灰显「原稿」时间轴与文本。
3. **编辑者提交修订**：可修改文本、起点、终点。每条提议都会记录：
   - 作者（author）；
   - **所依据版本**（`based_on_version`，即提议时该条的已接受版本号）。
   - 同一条字幕可以同时存在多个待审提议。
4. **审校者逐条处理**：
   - **接受**：校验通过后写入新的已接受版本，版本号 +1，提议标记为「已接受」并记录审校人；
   - **驳回**：标记为「已驳回」，可填写驳回原因，记录保留；
   - **版本冲突**：若提议依据的版本已不是当前版本（该条目之后已被其他修订更新），该提议显示「版本冲突 · 不可接受」，接受按钮禁用并给出明确提示；记录保留，可驳回后由编辑者依据最新版本重新提交。
5. **接受时的校验**（任一不通过则拒绝接受，**已接受版本绝不改变**）：
   - 起止时间非负；
   - 起点严格早于终点；
   - 修订后时间轴与其他任何已接受条目**不得重叠**（相邻端点相等允许，例如一条终点 = 下一条起点不算重叠）；
   - 接口返回中文错误原因（冲突 / 重叠 / 无权 / 非法输入）。
6. **导出 SRT**：只导出 `cues` 表中当前已接受版本，按时间轴排序，文件名 `accepted.srt`；待审与已驳回内容不会出现在导出文件中。

## 四、配置（环境变量）

在 `docker-compose.yml` 中通过环境变量配置，也可在命令行前缀覆盖：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `8080` | 宿主机映射端口，访问地址即 `http://localhost:${HOST_PORT}` |
| `JWT_SECRET` | `change-me-to-a-long-random-string` | 登录令牌签名密钥，**正式使用请修改** |
| `SEED_USERS` | `true` | 首次启动是否确保内置账号存在（已存在则不重复创建） |
| `SEED_SAMPLE_SRT` | `true` | 数据库全新时是否写入示例字幕 |
| `DB_PATH` | `/data/subtitles.db` | 容器内 SQLite 文件路径（位于持久化卷） |

例：更换端口、关闭示例数据：

```bash
HOST_PORT=9090 SEED_SAMPLE_SRT=false docker compose up -d --build
```

数据保存在 Docker 命名卷 `subtitle-data` 中；如需彻底重置：

```bash
docker compose down -v
```

## 五、本地开发（不使用 Docker）

需要 Node.js 20+。分别安装依赖、启动后端与前端：

```bash
# 终端 1：后端（默认 http://localhost:8080）
cd backend
npm install
# 可选配置：
# export DB_PATH=./data/subtitles.db JWT_SECRET=dev-secret PORT=8080
npm run dev          # 或 npm start

# 终端 2：前端（Vite 开发服务器 http://localhost:5173）
cd frontend
npm install
npm run dev
```

开发模式下前端通过 Vite 代理把 `/api` 请求转发到 `http://localhost:8080`，因此请同时打开：

> **http://localhost:5173**

生产构建（前端产物输出到 `frontend/dist`，容器中会被复制到后端 `public/` 由 Express 直接托管）：

```bash
cd frontend && npm run build
```

### 端到端业务测试

后端测试脚本会针对一个**全新数据库**上运行的服务，跑通登录鉴权、提议、冲突、重叠、非法 SRT、导入导出等 47 项场景：

```bash
# 终端 1：用临时数据库起服务
DB_PATH=/tmp/sp-test.db PORT=8088 JWT_SECRET=test node backend/src/server.js
# 终端 2：
BASE_URL=http://localhost:8088 npm --prefix backend run test:flow
```

## 六、主要 HTTP 接口

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/login` | 公开 | 登录，返回 JWT |
| GET | `/api/state` | 已登录 | 全部字幕（含原稿快照、版本）与全部提议 |
| POST | `/api/import` | 编辑者 / 审校者 | 导入 SRT（整体替换；非法或重叠返回 4xx 原因） |
| GET | `/api/export` | 编辑者 / 审校者 | 下载仅含已接受版本的 SRT |
| POST | `/api/cues/:id/proposals` | 编辑者 | 创建修订提议（记录作者与依据版本） |
| POST | `/api/proposals/:id/accept` | 审校者 | 接受提议（版本冲突 / 重叠 / 非法时返回错误原因且不改数据） |
| POST | `/api/proposals/:id/reject` | 审校者 | 驳回提议（可附原因，记录保留） |

错误统一返回 JSON：`{ "error": "中文原因", "code": "..." }`，典型 code：`INVALID_SRT`、`VALIDATION`、`VERSION_CONFLICT`、`OVERLAP`、`FORBIDDEN`、`UNAUTHORIZED`、`ALREADY_DECIDED`。

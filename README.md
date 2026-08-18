<img src="./public/favicon.png" alt="logo" width="140" height="140" align="right">

# UNM-Server 2.0.0 (TypeScript + Hono Edition)

网易云音乐解灰与跨平台音乐 API 服务，原生整合 **GD Studio API** 与 `@unblockneteasemusic/server` 0.28.0+，全面支持 **`home-4.1.7`** 前端主页及各类 Web 音乐播放器。

---

## 🌟 核心特性

- 🚀 **现代化技术栈**：基于 **TypeScript 5.x + Hono 4.x + ESM + Zod + tsup** 构建，体积小（30KB）、内存占用极低（<20MB），冷启动毫秒级。
- 🎵 **双轨智能调度引擎**：
  - **第一轨**：对齐 `@unblockneteasemusic/server` 0.28.0 最新 13 个音源（`bodian` 波点音乐、`kugou`、`kuwo`、`bilivideo`、`bilibili`、`qq`、`migu` 等）。
  - **第二轨**：深度整合 GD Studio 高清直链引擎，免 Cookie 秒级解锁周杰伦、陈奕迅等全网变灰无损歌曲。
- 🛡️ **生产级安全性与稳定性**：
  - 内置高性能 **泛型 LRU 内存缓存**（TTL + 容量自动淘汰，规避 5分钟50次 上游限流）。
  - 全局 Zod 入参清洗验证、CORS 域名白名单与安全响应头（Secure Headers）。
- ☁️ **全平台部署支持**：
  - **Docker Compose**（Linux 生产服务器一键部署）
  - **Node.js / PM2**（裸机与传统 VPS 运维）
  - **Vercel**（Serverless 云函数一键上线）
  - **Netlify**（Netlify Functions 部署）

---

## 🚀 生产部署方式

### 1. Linux 生产环境 Docker Compose 部署 (推荐)

项目已内置经过生产优化的 `docker-compose.yml`、`Dockerfile` 与 `.dockerignore`：

```bash
# 1. 克隆代码或将代码上传至 Linux 服务器
git clone <repository-url> unm-server
cd unm-server

# 2. 根据需要修改环境变量配置
cp .env.example .env
# nano .env

# 3. 使用 Docker Compose 一键构建并在后台启动
docker compose up -d

# 4. 查看实时运行日志与健康状态
docker compose logs -f
docker compose ps
```

常用运维命令：
```bash
# 停止服务
docker compose down

# 重新构建并平滑重启
docker compose up -d --build
```

---

### 2. Vercel 一键部署 (Serverless)

项目已内置 `vercel.json` 与 `api/index.ts`（适配 `hono/vercel`）：
1. 在 GitHub 上 Fork 或导入本项目。
2. 登录 [Vercel 控制台](https://vercel.com/)，点击 **New Project** 并选择导入此仓库。
3. 在 **Environment Variables** 中按需配置环境变量（如 `ALLOWED_DOMAIN`、`GDSTUDIO_API_URL`）。
4. 点击 **Deploy**，部署完成后即可获得全球 CDN 加速的 API 服务！

---

### 3. Netlify 一键部署 (Netlify Functions)

项目已内置 `netlify.toml` 与 `netlify/functions/api.ts`（适配 `hono/netlify`）：
1. 登录 [Netlify 控制台](https://app.netlify.com/)，选择 **Add new site** -> **Import an existing project**。
2. 选择本仓库，构建命令保持默认：
   - **Build command**: `pnpm build`
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
3. 点击 **Deploy site** 即可完成发布。

---

### 4. 传统 VPS / 裸机 Node.js 部署

```bash
# 1. 安装依赖与编译
pnpm install
pnpm build

# 2. 生产启动
pnpm start

# 或使用 PM2 守护进程启动
pnpm prd
```

---

## ⚙️ 环境变量配置 (`.env`)

详细配置项参见 `.env.example`：

```ini
# 服务端口（默认 5678）
PORT=5678

# 跨域安全允许域名（* 为允许所有，多个用逗号分隔）
ALLOWED_DOMAIN='*'

# GD Studio 音乐 API 地址
GDSTUDIO_API_URL='https://music-api.gdstudio.xyz/api.php'

# 请求超时时间（毫秒）
REQUEST_TIMEOUT=10000

# 音频反代前缀（选填）
PROXY_URL=''

# LRU 缓存条目上限
CACHE_MAX_SIZE=2000

# 默认歌曲解灰音源优先级
DEFAULT_MATCH_SERVERS='gdstudio,pyncmd,bodian,joox,kugou,kuwo,bilivideo,bilibili'
```

---

## 📚 接口契约列表 (`home-4.1.7` 100% 兼容)

| 端点 | 方法 | 说明 | 主要参数 |
| :--- | :--- | :--- | :--- |
| `/info` | `GET` | 获取服务版本与 13 个音源状态 | 无 |
| `/health` | `GET` | 服务健康状态与内存/缓存指标 | `verbose=true` (可选) |
| `/ping` | `GET` | 快速存活探测 | 无 |
| `/test` | `GET` | 快速匹配测试（默认测试 1962165898） | 无 |
| `/match` | `GET` | 核心歌曲解灰匹配 | `id` (网易云歌曲ID), `server` (音源), `br` |
| `/ncmget` | `GET` | 网易云歌曲直链获取 | `id` (网易云歌曲ID), `br` (128/192/320/740/999) |
| `/otherget` | `GET` | 其他音源（酷我/Joox）按歌名搜索直链 | `name` (歌曲名称) |
| `/playlist/:id` | `GET` | 获取网易云歌单/专辑歌曲 ID 列表 | `id` (歌单或专辑ID) |
| `/search` | `GET` | 跨平台歌曲搜索 | `name` (关键词), `source`, `count`, `pages` |
| `/pic` 或 `/picture` | `GET` | 获取专辑封面 | `id` (图片ID), `source`, `size` (300/500) |
| `/lyric` | `GET` | 获取 LRC 歌词与中文翻译 | `id` (歌词ID), `source` |

---

## 📄 开源许可证

[MIT License](LICENSE)

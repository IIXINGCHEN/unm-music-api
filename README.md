<div align="center">

<img src="./public/favicon.png" alt="UNM-Server Logo" width="128" height="128" />

# UNM-Server

**网易云音乐解灰与跨平台高保真音乐 API 服务**  
*(Modern TypeScript 5.x + Hono 4.x + Serverless Edition)*

[![Version](https://img.shields.io/badge/version-v3.1.0-sky.svg?style=flat-square)](https://github.com/IIXINGCHEN/unm-music-api/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-indigo.svg?style=flat-square)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-multi--arch-blue.svg?style=flat-square)](https://github.com/IIXINGCHEN/unm-music-api/pkgs/container/unm-music-api)
[![Hono](https://img.shields.io/badge/framework-Hono_v4-orange.svg?style=flat-square)](https://hono.dev/)
[![TypeScript](https://img.shields.io/badge/language-TypeScript_5-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Vercel](https://img.shields.io/badge/deploy-Vercel_Ready-black.svg?style=flat-square)](https://vercel.com/)

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-生产部署方式">部署指南</a> •
  <a href="#-环境变量配置-env">配置字典</a> •
  <a href="#-rest-api-接口契约规范">API 规范</a> •
  <a href="#-可视化监控大盘">监控大盘</a> •
  <a href="#-目录架构规范">架构拓扑</a>
</p>

</div>

---

## 📖 项目简介

**UNM-Server** 是专为各类 Web 音乐播放器、前端主页（完美 100% 原生支持 **`home-4.1.7`**）打造的下一代现代化音乐解灰与音频调度中台。

项目原生整合 **GD Studio API** 高清直链调度引擎与官方 **`@unblockneteasemusic/server` 0.28.0+** 解密生态，彻底摆脱传统方案繁琐的自备 Cookie、高内存占用与易失效问题，提供超低延迟、无损音质（128k ~ 999k FLAC）及秒级跨平台音源自动降级检索。

---

## 🌟 核心特性

- 🚀 **极速轻量与极低消耗**：
  - 基于 **TypeScript 5 + Hono 4 + ESM + tsup** 极速单 Bundle 架构，打包产物仅 **~52 KB**。
  - 运行时内存驻留 **< 20 MB**，支持秒级冷启动与超高并发 QPS。
- 🎵 **双轨混合智能调度引擎**：
  - **第一轨 (UNM 0.28.0+ 引擎)**：完整覆盖官方全部 13 大主流音源（`bodian` 波点、`kugou`、`kuwo`、`bilivideo`、`bilibili`、`qq`、`migu`、`ytdlp`、`youtube` 等）。
  - **第二轨 (GD Studio 极速引擎)**：深度直连 GD Studio 镜像集群，无需 Cookie 秒级解锁周杰伦、陈奕迅等全网变灰 VIP / 独家无损歌曲。
- 🛡️ **企业级安全与防御体系**：
  - **时序攻击防御**：管理与监控接口采用 SHA-256 定长摘要 + `crypto.timingSafeEqual` 恒定时间校验。
  - **流量与防刷控制**：内置基于滑动窗口的 RateLimiter 中间件，自动剥离与脱敏敏感请求凭据。
  - **容器最小特权**：Dockerfile 生产运行镜像强制声明 `USER node` (UID 1000)，杜绝 Root 特权逃逸。
  - **全域 CORS 与预检秒级响应**：严格遵循 W3C Fetch 规范，跨域凭据按需自适应。
- ⚡ **高性能泛型 LRU 缓存**：
  - 自研具备 TTL 过期时间与容量上限淘汰的 LRU 内存缓存池，歌曲匹配、搜索与专辑封面命中率超 90%，有效规避上游频率限制。
- 📊 **开箱即用可视化监控大盘**：
  - 内置 `/dashboard` 实时统计看板，支持流量趋势、成功率分布、音源命中占比及敏感日志清洗检索。
- ☁️ **全场景云原生与 Serverless 部署**：
  - 深度适配 Docker Compose、Vercel Serverless、Netlify Functions 及传统 Linux VPS / PM2。

---

## 🚀 生产部署方式

### 方式 1: Docker Compose 一键部署 (推荐)

仓库已集成 GitHub Actions 自动化流水线，已编译并推送 **`linux/amd64`** 与 **`linux/arm64`** 多架构镜像至 GitHub Container Registry (`ghcr.io`)，无需本地安装 Node 环境：

```bash
# 1. 克隆仓库
git clone https://github.com/IIXINGCHEN/unm-music-api.git unm-server
cd unm-server

# 2. 从模板复制生产环境变量
cp .env.example .env

# 3. 拉取最新镜像并在后台运行
docker compose pull
docker compose up -d

# 4. 查看实时运行日志与健康状态
docker compose logs -f
```

**常用运维指令**：
```bash
# 平滑升级至最新版本
docker compose pull && docker compose up -d

# 本地源码重新编译启动
docker compose up -d --build

# 停止并移除容器服务
docker compose down
```

---

### 方式 2: Vercel 一键部署 (Serverless)

本项目针对 Vercel Node.js Serverless 运行时进行了专门适配与原生兼容（内置 `vercel.json` 与 `api/index.ts`）：

1. 在 GitHub 上 Fork 本项目。
2. 登录 [Vercel 控制台](https://vercel.com/)，选择 **New Project** 并导入 Fork 后的仓库。
3. 在 **Settings -> Environment Variables** 中按需填入配置（如 `ALLOWED_DOMAIN`、`MONITOR_SECRET_KEY` 等）。
4. 点击 **Deploy**，几秒后即可获得自带全球 Edge CDN 加速的 API 服务！

---

### 方式 3: Netlify Functions 部署

项目内置 `netlify.toml` 与 `netlify/functions/api.ts` 运行时事件循环解锁适配：

1. 登录 [Netlify 控制台](https://app.netlify.com/)，选择 **Add new site** -> **Import an existing project**。
2. 选择本仓库，配置构建设置：
   - **Build command**: `pnpm build`
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
3. 点击 **Deploy site** 即刻上线。

---

### 方式 4: 传统 VPS / 裸机 Node.js 部署

运行要求：**Node.js >= 18.0.0**，推荐使用 **pnpm**。

```bash
# 1. 安装项目依赖
pnpm install

# 2. 编译 TypeScript 打包产物
pnpm build

# 3. 生产模式前台启动
pnpm start

# 4. 或使用 PM2 进行多核进程守护
pnpm prd
```

---

## ⚙️ 环境变量配置字典 (`.env`)

所有配置项均拥有严谨的默认兜底值与 Zod 运行时强类型校验，可直接修改 `.env` 文件：

| 环境变量名 | 类型 | 默认值 | 描述说明 |
|:---|:---|:---|:---|
| `PORT` | Number | `5678` | 服务监听端口 |
| `HOST` | String | `0.0.0.0` | 监听主机地址 |
| `NODE_ENV` | String | `production` | 运行环境 (`development` / `production`) |
| `ALLOWED_DOMAIN` | String | `*` | 跨域允许来源 (`*` 或 `https://domain.com,https://app.com`) |
| `MONITOR_SECRET_KEY` | String | `""` | 监控大盘与管理接口鉴权秘钥（留空则不开启鉴权） |
| `ENABLE_RATE_LIMIT` | Boolean | `true` | 是否启用 API 滑动窗口速率限制防护 |
| `RATE_LIMIT_WINDOW_MS`| Number | `60000` | 限流滑动时间窗口大小 (毫秒，默认 1分钟) |
| `RATE_LIMIT_MAX_REQUESTS`| Number | `120` | 单 IP 在时间窗口内的最大允许请求次数 |
| `GDSTUDIO_API_URL` | String | `https://music-api.gdstudio.xyz/api.php` | GD Studio 音乐引擎 API 上游地址 |
| `DEFAULT_MATCH_SERVERS`| String | `gdstudio,pyncmd,bodian,joox,kugou,kuwo,bilivideo,bilibili` | 歌曲解灰匹配默认音源优先级顺序 |
| `DEFAULT_BITRATE` | Number | `320` | 默认音频码率 (支持 `128`, `192`, `320`, `740`, `999` FLAC) |
| `ENABLE_FLAC` | Boolean | `true` | 是否允许返回无损 FLAC 格式音频 |
| `CACHE_MAX_SIZE` | Number | `2000` | LRU 内存缓存池最大条目上限 |
| `CACHE_TTL_AUDIO` | Number | `3600` | 音频播放链接缓存时长 (秒，默认 1 小时) |
| `REQUEST_TIMEOUT` | Number | `10000` | 上游接口请求超时时间 (毫秒) |

---

## 📚 REST API 接口契约规范

全站 API 返回格式均严格遵循统一标准信封结构：

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

### 1. 核心歌曲解灰匹配 (`/match`)
- **方法**: `GET`
- **核心参数**:
  - `id` *(必填, String)*: 网易云音乐歌曲 ID (如 `1962165898`)
  - `br` *(选填, Number)*: 目标码率 (128 / 192 / 320 / 740 / 999，默认 `320`)
  - `server` *(选填, String)*: 指定匹配音源，逗号分隔 (如 `gdstudio,bodian,kuwo`)
- **响应示例**:
  ```json
  {
    "code": 200,
    "message": "匹配成功",
    "data": {
      "url": "https://music.163.com/song/media/outer/url?id=1962165898.mp3",
      "br": 320,
      "size": 9482103,
      "source": "gdstudio",
      "md5": null
    }
  }
  ```

### 2. 网易云歌曲直链获取 (`/ncmget`)
- **方法**: `GET`
- **参数**: `id` (必填), `br` (选填)
- **响应示例**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "url": "https://...",
      "br": 320,
      "size": 10248800
    }
  }
  ```

### 3. 跨平台多源音乐搜索 (`/search`)
- **方法**: `GET`
- **参数**:
  - `name` *(必填)*: 歌曲名 / 歌手 / 关键词
  - `source` *(选填)*: 音源类型 (`netease`, `kugou`, `kuwo`, `bilibili` 等，默认 `netease`)
  - `count` *(选填)*: 返回数量 (默认 20，最大 100)
  - `pages` / `page` *(选填)*: 分页页码 (默认 1)

### 4. 歌词获取 (`/lyric`)
- **方法**: `GET`
- **参数**: `id` (必填), `source` (选填)
- **响应示例**:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {
      "lyric": "[00:00.000] 作词 : ...\n[00:01.000] 作曲 : ...",
      "tlyric": "[00:01.000] 中文翻译歌词..."
    }
  }
  ```

### 5. 专辑封面图获取 (`/pic` 或 `/picture`)
- **方法**: `GET`
- **参数**: `id` (必填), `source` (选填), `size` (选填: `300` 或 `500`)

### 6. 歌单歌曲 ID 提取 (`/playlist/:id`)
- **方法**: `GET`
- **参数**: `:id` (歌单或专辑 ID)
- **说明**: 批量提取歌单或专辑下所有歌曲 ID 组成的字符串数组。

### 7. 系统状态与监控大盘 API
- `GET /info`：获取服务基础信息、版本 (`3.1.0`) 及当前启用的可用音源列表。
- `GET /health`：获取健康检查探针，支持 `?verbose=true` 查看 Node.js 内存占用与缓存命中统计。
- `GET /ping`：轻量秒级存活检查（返回 `{"code": 200, "message": "pong"}`）。
- `GET /api/monitor/data`：拉取近 1000 条脱敏请求审计日志、QPS、状态码与音源命中率（受 `MONITOR_SECRET_KEY` 保护）。

---

## 📊 可视化监控大盘

访问部署地址下的 **`/dashboard`**（例如 `http://localhost:5678/dashboard`）即可打开开箱即用的实时调用大盘：

- **实时流量指标**：实时 QPS、平均响应时延、状态码分布统计。
- **音源命中率分析**：13 大音源命中占比与解析成功率。
- **请求审计流水**：实时访问日志流，内置搜索过滤与关键敏感信息脱敏防护。
- **安全鉴权防护**：若配置了 `MONITOR_SECRET_KEY`，前端将自动引导输入并安全持久化鉴权凭据。

---

## 📁 目录架构规范 (分层语义小驼峰)

项目严格遵守 **Clean Architecture** 单向分层原则，文件命名采用全小驼峰分层前缀规范：

```text
src/
├── config/                     # 配置中心
│   ├── configConstants.ts      # 系统静态常量与音源配置
│   ├── configEnv.ts            # Zod 环境变量提取与校验
│   ├── configVersion.ts        # 全局唯一版本号维护源 (Single Source of Truth)
│   └── index.ts                # 桶导出
├── middlewares/                # 请求拦截与安全防护
│   ├── middlewareAuth.ts       # 时序安全 API Key 鉴权中间件
│   ├── middlewareRateLimit.ts  # 滑动窗口速率限制中间件
│   └── index.ts                # 桶导出
├── routes/                     # RESTful 路由控制层
│   ├── routeInfo.ts            # /info, /health, /ping
│   ├── routeMonitor.ts         # /api/monitor/*
│   ├── routeMusic.ts           # /match, /ncmget, /otherget, /test
│   ├── routeResource.ts        # /search, /pic, /lyric, /playlist
│   └── index.ts                # 聚合路由挂载
├── services/                   # 领域核心业务服务
│   ├── serviceCache.ts         # 泛型 LRU 内存缓存服务
│   ├── serviceGdStudio.ts      # GD Studio 上游接口调度与转换
│   ├── serviceMonitor.ts       # 请求指标统计与脱敏日志管理器
│   ├── serviceUnm.ts           # UNM 0.28.0+ 引擎适配与 Provider 注入
│   └── index.ts                # 桶导出
├── types/                      # TypeScript 类型契约
│   ├── typeApi.ts              # API 通用信封与探针类型
│   ├── typeMusic.ts            # 音乐元数据与 GD 响应契约
│   └── index.ts                # 桶导出
├── utils/                      # 纯函数工具库
│   ├── utilPath.ts             # 跨 ESM/CJS/Serverless 多环境路径解析
│   ├── utilResponse.ts         # 统一成功/异常信封封装
│   ├── utilSecurity.ts         # 域名白名单校验、timingSafeCompare 与脱敏
│   ├── utilString.ts           # 字符串安全清洗与代理 URL 格式化
│   └── index.ts                # 桶导出
├── app.ts                      # Hono 应用工厂与中间件装配
└── index.ts                    # Node.js 本地服务器主入口
```

---

## 🤝 鸣谢与生态 (Credits)

- [UnblockNeteaseMusic/server](https://github.com/UnblockNeteaseMusic/server) - 经典的网易云音乐解密规则引擎
- [GD Studio](https://music.gdstudio.xyz) - 高可用跨平台音乐聚合与直链调度服务
- [Hono](https://hono.dev/) - 极致超轻量、全云平台通用的 Web 框架
- [home-4.1.7](https://github.com/imsyy/home) - 优雅出色的个人主页 Web 音乐播放器

---

## 📄 开源许可证

本项目基于 **[MIT License](LICENSE)** 协议开源，欢迎提交 Issue 与 Pull Request 共同改进！

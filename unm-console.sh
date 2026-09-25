#!/usr/bin/env bash
# ==============================================================================
# UNM-Server 一键管理控制台 · Linux / macOS 版
# Windows 请使用同目录的 unm-console.ps1（功能对齐）
#
#   生产 / 开发 双环境，支持：启动(前/后台) / 停止 / 重启 / 状态 / 检测配置 / 日志
#
# 用法:
#   ./unm-console.sh                          # 交互菜单
#   ./unm-console.sh start   --env prod --port 5678
#   ./unm-console.sh start   --env dev --fg    # 前台启动开发环境
#   ./unm-console.sh stop    --env prod
#   ./unm-console.sh restart --env prod
#   ./unm-console.sh status  [--env prod]     # 省略 --env 则显示双环境
#   ./unm-console.sh check   --env prod       # 检测配置（9 项自检）
#   ./unm-console.sh logs    --env prod [--lines 100] [-f]
#   ./unm-console.sh install                  # pnpm install
#   ./unm-console.sh build                    # pnpm build（生产包）
# ==============================================================================
set -u

CONSOLE_VERSION="1.0.0"

# ---------------- 路径 ----------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$SCRIPT_DIR/.unm-console"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR" 2>/dev/null

# ---------------- 颜色 ----------------
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RST='\033[0m'; C_RED='\033[31m'; C_GRN='\033[32m'; C_YLW='\033[33m'
  C_BLU='\033[34m'; C_CYN='\033[36m'; C_BLD='\033[1m'
else
  C_RST=''; C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_CYN=''; C_BLD=''
fi

log()  { printf '%b\n' "${C_BLU}[unm]${C_RST} $*"; }
ok()   { printf '%b\n' "${C_GRN}[ OK ]${C_RST} $*"; }
warn() { printf '%b\n' "${C_YLW}[WARN]${C_RST} $*"; }
err()  { printf '%b\n' "${C_RED}[FAIL]${C_RST} $*" >&2; }
die()  { err "$*"; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

# ---------------- .env 读取（只取控制台需要的键） ----------------
# 用法: dotenv_get KEY [默认值]
dotenv_get() {
  local key="$1" def="${2:-}" val=""
  if [ -f "$SCRIPT_DIR/.env" ]; then
    val="$(grep -E "^[[:space:]]*${key}=" "$SCRIPT_DIR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
    val="$(printf '%s' "$val" | tr -d '\r' | sed -e "s/^[[:space:]'\"]*//" -e "s/[[:space:]'\"]*$//")"
  fi
  if [ -n "$val" ]; then printf '%s' "$val"; else printf '%s' "$def"; fi
}

# ---------------- 环境 / 端口解析 ----------------
# 优先级: --port > .env DEV_PORT(仅dev) > .env PORT > 5678
resolve_port() {
  local env="$1" cli_port="${2:-}"
  if [ -n "$cli_port" ]; then printf '%s' "$cli_port"; return; fi
  if [ "$env" = "dev" ]; then
    local dp; dp="$(dotenv_get DEV_PORT "")"
    if [ -n "$dp" ]; then printf '%s' "$dp"; return; fi
  fi
  printf '%s' "$(dotenv_get PORT "5678")"
}

resolve_host() { printf '%s' "$(dotenv_get HOST "127.0.0.1")"; }

valid_env() { [ "$1" = "prod" ] || [ "$1" = "dev" ]; }

node_env_of() { [ "$1" = "prod" ] && printf 'production' || printf 'development'; }

pid_file_of() { [ -n "${1:-}" ] || return 1; printf '%s/unm-%s.pid' "$PID_DIR" "$1"; }
log_file_of() { [ -n "${1:-}" ] || return 1; printf '%s/unm-%s.log' "$LOG_DIR" "$1"; }

read_pid() {
  local f; f="$(pid_file_of "$1")"
  [ -f "$f" ] && tr -d '\r\n ' < "$f" || printf ''
}

write_pid() { printf '%s' "$2" > "$(pid_file_of "$1")"; }
clear_pid() { rm -f "$(pid_file_of "$1")"; }
port_file_of() { [ -n "${1:-}" ] || return 1; printf '%s/unm-%s.port' "$PID_DIR" "$1"; }
read_port() { local f; f="$(port_file_of "$1")" || return 1; [ -f "$f" ] && tr -d '\r\n ' < "$f" || printf ''; }
write_port() { printf '%s' "$2" > "$(port_file_of "$1")"; }
clear_port() { rm -f "$(port_file_of "$1")"; }
# 运行中的实际端口：优先用启动时记录的，否则按配置解析
live_port() { local rp; rp="$(read_port "$1")"; if [ -n "$rp" ]; then printf '%s' "$rp"; else resolve_port "$1" ""; fi; }

pid_alive() {
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null
}

# ---------------- 端口 / 健康探测 ----------------
port_in_use() {
  local port="$1" host
  for host in 127.0.0.1 "$(resolve_host)"; do
    if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
      exec 3>&- 3<&-
      return 0
    fi
  done
  return 1
}

http_get() { # $1=url -> 打印 body, 成功返回0
  curl -sf --max-time 3 "$1" 2>/dev/null
}

wait_for_health() { # $1=port $2=超时秒
  local port="$1" timeout="${2:-15}" i=0
  while [ "$i" -lt "$timeout" ]; do
    if http_get "http://127.0.0.1:${port}/health" | grep -q '"status":"healthy"'; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# 通过端口反查进程 PID（尽力而为：lsof -> ss -> fuser）
pids_by_port() {
  local port="$1" out=""
  if command -v lsof >/dev/null 2>&1; then
    out="$(lsof -ti "tcp:${port}" 2>/dev/null | tr '\n' ' ')"
  elif command -v ss >/dev/null 2>&1; then
    out="$(ss -ltnp 2>/dev/null | grep ":${port} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | tr '\n' ' ')"
  elif command -v fuser >/dev/null 2>&1; then
    out="$(fuser "${port}/tcp" 2>/dev/null | tr '\n' ' ')"
  fi
  printf '%s' "$out"
}

# ---------------- 启动 ----------------
# do_start <prod|dev> <bg|fg> <port>
do_start() {
  local env="$1" mode="$2" port="$3"
  local host node_env logfile pid
  host="$(resolve_host)"; node_env="$(node_env_of "$env")"; logfile="$(log_file_of "$env")"

  valid_env "$env" || die "未知环境: $env（可选 prod / dev）"
  case "$port" in ''|*[!0-9]*) die "端口非法: $port";; esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "端口超出范围: $port"

  pid="$(read_pid "$env")"
  if pid_alive "$pid"; then
    err "[$env] 已在运行 (PID $pid)，先 stop 或 restart"
    return 1
  fi
  clear_pid "$env"
  if port_in_use "$port"; then
    err "[$env] 端口 $port 已被占用（可能有其他进程在跑），先释放或换 --port"
    return 1
  fi

  if [ "$env" = "prod" ]; then
    [ -f "$SCRIPT_DIR/dist/index.js" ] || die "缺少 dist/index.js，请先运行: $0 build"
    start_cmd="node dist/index.js"
  else
    [ -x "$SCRIPT_DIR/node_modules/.bin/tsx" ] || die "缺少 tsx（dev 依赖），请先运行: $0 install"
    [ -f "$SCRIPT_DIR/src/index.ts" ] || die "缺少 src/index.ts"
    start_cmd="node_modules/.bin/tsx watch src/index.ts"
  fi

  if [ "$mode" = "fg" ]; then
    log "前台启动 [$env] NODE_ENV=$node_env PORT=$port（Ctrl+C 退出）"
    cd "$SCRIPT_DIR" || die "无法进入 $SCRIPT_DIR"
    # shellcheck disable=SC2086
    exec env NODE_ENV="$node_env" PORT="$port" HOST="$host" $start_cmd
  fi

  log "后台启动 [$env] NODE_ENV=$node_env PORT=$port ..."
  cd "$SCRIPT_DIR" || die "无法进入 $SCRIPT_DIR"
  # shellcheck disable=SC2086
  env NODE_ENV="$node_env" PORT="$port" HOST="$host" nohup $start_cmd >>"$logfile" 2>&1 &
  pid=$!
  write_pid "$env" "$pid"
  write_port "$env" "$port"
  printf '%s' "$env" > "$STATE_DIR/last.env"

  if wait_for_health "$port" 20; then
    ok "[$env] 启动成功  PID=$pid  http://${host}:${port}/"
  else
    warn "[$env] 进程已拉起 (PID $pid) 但 20s 内健康检查未通过，查看日志:"
    tail -n 20 "$logfile" 2>/dev/null | sed 's/^/  | /'
    warn "若端口冲突或配置错误，先 $0 stop --env $env 再排查"
    return 1
  fi
}

# ---------------- 停止 ----------------
# do_stop <prod|dev> <force:0|1>
do_stop() {
  local env="$1" force="${2:-0}" pid port i
  valid_env "$env" || die "未知环境: $env"
  pid="$(read_pid "$env")"

  if pid_alive "$pid"; then
    log "停止 [$env] (PID $pid) ..."
    kill "$pid" 2>/dev/null
    i=0
    while pid_alive "$pid" && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
    if pid_alive "$pid"; then
      warn "优雅停止超时，强制 kill -9"
      kill -9 "$pid" 2>/dev/null
      sleep 1
    fi
    clear_pid "$env"; clear_port "$env"
    pid_alive "$pid" && { err "[$env] 停止失败"; return 1; }
    ok "[$env] 已停止"
    return 0
  fi
  port="$(live_port "$env")"
  clear_pid "$env"; clear_port "$env"
  if [ "$force" = "1" ] && port_in_use "$port"; then
    local pids; pids="$(pids_by_port "$port")"
    if [ -n "$pids" ]; then
      warn "按端口 $port 反查到进程: $pids，强制结束"
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null
      sleep 2
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null
      port_in_use "$port" && { err "端口 $port 仍被占用"; return 1; }
      ok "端口 $port 已释放"
      return 0
    fi
  fi
  if port_in_use "$port"; then
    warn "[$env] 无 PID 记录，但端口 $port 仍被占用（可能手动启动）。加 --force 按端口强杀，或手动处理。"
    return 1
  fi
  log "[$env] 未在运行"
  return 0
}

# ---------------- 重启 ----------------
# do_restart <prod|dev> <port|空=自动>
do_restart() {
  local env="$1" cli_port="${2:-}" port
  valid_env "$env" || die "未知环境: $env"
  port="$(resolve_port "$env" "$cli_port")"
  log "重启 [$env] ..."
  do_stop "$env" 0 || true
  sleep 1
  do_start "$env" "bg" "$port"
}

# ---------------- 状态 ----------------
# do_status [prod|dev|all]
do_status() {
  local env="${1:-all}" target
  need_cmd curl
  printf '%b\n' "${C_BLD}UNM-Server 运行状态${C_RST}"
  printf '%-6s %-8s %-7s %-5s %s\n' "环境" "PID" "端口" "健康" "版本/运行时长"
  for target in prod dev; do
    if [ "$env" != "all" ] && [ "$env" != "$target" ]; then continue; fi
    local pid port health info ver up
    pid="$(read_pid "$target")"
    port="$(live_port "$target")"
    health="-"; ver="-"; up="-"
    if pid_alive "$pid"; then
      info="$(http_get "http://127.0.0.1:${port}/info")"
      if [ -n "$info" ]; then
        health="${C_GRN}UP${C_RST}"
        ver="$(printf '%s' "$info" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)"
        up="$(printf '%s' "$info" | grep -o '"uptime":[0-9]*' | cut -d: -f2)"
        [ -n "$up" ] && up="${up}s"
      else
        health="${C_YLW}无响应${C_RST}"
        pid="${pid}?"
      fi
    else
      pid="-"
      port_in_use "$port" && health="${C_YLW}端口占用${C_RST}"
    fi
    printf "%-6s %-8s %-7s %-5b %s %s\n" "$target" "$pid" "$port" "$health" "$ver" "$up"
  done
}

# ---------------- 检测配置（9 项自检） ----------------
# do_check [prod|dev|all]
do_check() {
  local env="${1:-all}" fail=0 warn_n=0
  need_cmd node
  printf '%b\n' "${C_BLD}UNM-Server 配置检测${C_RST}（环境: $env）"
  printf '%-4s %s\n' "----" "----------------------------------------"

  pass() { ok "$1"; }
  w()    { warn "$1"; warn_n=$((warn_n + 1)); }
  f()    { err "$1"; fail=$((fail + 1)); }

  # 1. Node.js 版本
  node_ver="$(node --version 2>/dev/null | tr -d 'v')"
  node_major="${node_ver%%.*}"
  case "$node_major" in ''|*[!0-9]*) f "1. Node.js 不可用" ;;
    *) if [ "$node_major" -ge 18 ]; then pass "1. Node.js v$node_ver (>=18)"; else f "1. Node.js v$node_ver 过低，需要 >=18"; fi ;;
  esac

  # 2. pnpm
  if command -v pnpm >/dev/null 2>&1; then
    pass "2. pnpm $(pnpm --version 2>/dev/null) 可用"
  else
    w "2. 未找到 pnpm（如需 install/build 请先安装，或 corepack enable）"
  fi

  # 3. 依赖安装
  if [ -d "$SCRIPT_DIR/node_modules" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
    pass "3. node_modules 已安装"
  else
    f "3. node_modules 缺失，请运行: $0 install"
  fi

  # 4. 运行载体
  if [ "$env" = "prod" ] || [ "$env" = "all" ]; then
    if [ -f "$SCRIPT_DIR/dist/index.js" ]; then pass "4a. 生产包 dist/index.js 存在"
    else f "4a. 生产包缺失，请运行: $0 build"; fi
  fi
  if [ "$env" = "dev" ] || [ "$env" = "all" ]; then
    if [ -x "$SCRIPT_DIR/node_modules/.bin/tsx" ]; then pass "4b. tsx 可用（开发环境热重载）"
    else f "4b. tsx 缺失，请运行: $0 install"; fi
  fi

  # 5. .env 字段合法性
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    w "5. 未找到 .env，将使用内置默认配置（如需自定义请 cp .env.example .env）"
  else
    env_bad=0
    check_port() { # $1=值 $2=名
      case "$1" in ''|*[!0-9]*) env_bad=1; f "5. $2 非法: $1";; *)
        if [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; then :; else env_bad=1; f "5. $2 超出范围: $1"; fi;; esac
    }
    p="$(dotenv_get PORT "")";   [ -n "$p" ] && check_port "$p" "PORT"
    p="$(dotenv_get DEV_PORT "")"; [ -n "$p" ] && check_port "$p" "DEV_PORT"
    ne="$(dotenv_get NODE_ENV "")"
    if [ -n "$ne" ]; then
      case "$ne" in production|development|test) ;; *) env_bad=1; f "5. NODE_ENV 非法: $ne";; esac
    fi
    for bf in ENABLE_FLAC SELECT_MAX_BR FOLLOW_SOURCE_ORDER SEARCH_ALBUM ENABLE_RATE_LIMIT; do
      bv="$(dotenv_get "$bf" "")"
      if [ -n "$bv" ]; then
        case "$bv" in true|false) ;; *) env_bad=1; f "5. $bf 应为 true/false，实际: $bv";; esac
      fi
    done
    for nf in REQUEST_TIMEOUT CACHE_MAX_SIZE DEFAULT_BITRATE DEFAULT_SEARCH_COUNT; do
      nv="$(dotenv_get "$nf" "")"
      if [ -n "$nv" ]; then
        case "$nv" in ''|*[!0-9]*) env_bad=1; f "5. $nf 应为数字，实际: $nv";; esac
      fi
    done
    gu="$(dotenv_get GDSTUDIO_API_URL "")"
    if [ -n "$gu" ]; then
      case "$gu" in http://*|https://*) ;; *) env_bad=1; f "5. GDSTUDIO_API_URL 非法: $gu";; esac
    fi
    [ "$env_bad" = "0" ] && pass "5. .env 字段校验通过"
  fi

  # 6. 端口可用性
  for target in prod dev; do
    if [ "$env" != "all" ] && [ "$env" != "$target" ]; then continue; fi
    tp="$(resolve_port "$target" "")"
    if port_in_use "$tp"; then
      w "6. [$target] 端口 $tp 已被占用"
    else
      pass "6. [$target] 端口 $tp 空闲"
    fi
  done

  # 7. 上游 API 可达性
  gu="$(dotenv_get GDSTUDIO_API_URL "https://music-api.gdstudio.xyz/api.php")"
  if curl -sI --max-time 8 "$gu" >/dev/null 2>&1; then
    pass "7. 上游 GDSTUDIO_API_URL 可达"
  else
    w "7. 上游 GDSTUDIO_API_URL 不可达（网络/代理问题，服务仍可启动但解析可能失败）"
  fi

  # 8. 状态目录可写
  if touch "$STATE_DIR/.w" 2>/dev/null; then rm -f "$STATE_DIR/.w"; pass "8. 状态目录可写 ($STATE_DIR)"
  else f "8. 状态目录不可写: $STATE_DIR"; fi

  # 9. tailwindcss（构建需要）
  if [ -x "$SCRIPT_DIR/node_modules/.bin/tailwindcss" ]; then pass "9. tailwindcss 可用"
  else w "9. tailwindcss 缺失（build 时会自动处理，或先 install）"; fi

  printf '%-4s %s\n' "----" "----------------------------------------"
  if [ "$fail" -gt 0 ]; then
    err "检测完成: $fail 项失败，$warn_n 项警告 —— 请先修复失败项"
    return 1
  elif [ "$warn_n" -gt 0 ]; then
    warn "检测完成: 0 项失败，$warn_n 项警告 —— 可启动，建议处理警告"
    return 0
  else
    ok "检测完成: 全部通过，可以启动"
    return 0
  fi
}

# ---------------- 日志 ----------------
# do_logs <prod|dev> <lines> <follow:0|1>
do_logs() {
  local env="$1" lines="${2:-100}" follow="${3:-0}" f
  valid_env "$env" || die "未知环境: $env"
  f="$(log_file_of "$env")"
  [ -f "$f" ] || die "暂无日志: $f（服务未启动过）"
  if [ "$follow" = "1" ]; then
    log "实时跟踪 [$env] 日志（Ctrl+C 退出）: $f"
    tail -n "$lines" -f "$f"
  else
    tail -n "$lines" "$f"
  fi
}

# ---------------- 安装依赖 / 构建 ----------------
do_install() {
  cd "$SCRIPT_DIR" || die "无法进入 $SCRIPT_DIR"
  if ! command -v pnpm >/dev/null 2>&1; then
    warn "未找到 pnpm，尝试 corepack 启用..."
    corepack enable >/dev/null 2>&1 && corepack prepare pnpm@latest --activate >/dev/null 2>&1
    command -v pnpm >/dev/null 2>&1 || die "pnpm 不可用，请手动安装 Node.js LTS + pnpm"
  fi
  log "安装依赖 (pnpm install) ..."
  pnpm install || die "pnpm install 失败"
  ok "依赖安装完成"
}

do_build() {
  cd "$SCRIPT_DIR" || die "无法进入 $SCRIPT_DIR"
  command -v pnpm >/dev/null 2>&1 || die "缺少 pnpm，请先运行: $0 install"
  log "构建生产包 (pnpm build: 版本同步 + tailwind + tsup) ..."
  pnpm build || die "pnpm build 失败"
  ok "构建完成: dist/index.js"
}

# ---------------- 交互菜单 ----------------
ask_env() { # $1=提示 -> echo prod|dev
  local ans
  printf '%b' "${C_CYN}?${C_RST} $1 [prod/dev，默认 prod]: "
  read -r ans
  case "$ans" in dev|d) printf 'dev';; *) printf 'prod';; esac
}

show_menu() {
  while true; do
    printf '\n%b\n' "${C_BLD}==== UNM-Server 一键控制台 v${CONSOLE_VERSION} ====${C_RST}"
    printf '  1) 启动生产环境 (后台)\n'
    printf '  2) 启动生产环境 (前台)\n'
    printf '  3) 启动开发环境 (后台)\n'
    printf '  4) 启动开发环境 (前台)\n'
    printf '  5) 重启服务\n'
    printf '  6) 停止服务\n'
    printf '  7) 查看状态\n'
    printf '  8) 检测配置\n'
    printf '  9) 查看日志\n'
    printf ' 10) 安装依赖\n'
    printf ' 11) 构建生产包\n'
    printf '  0) 退出\n'
    printf '%b' "${C_CYN}?${C_RST} 请选择: "
    read -r choice
    case "$choice" in
      1) do_start prod bg "$(resolve_port prod "")" ;;
      2) do_start prod fg "$(resolve_port prod "")" ;;
      3) do_start dev bg "$(resolve_port dev "")" ;;
      4) do_start dev fg "$(resolve_port dev "")" ;;
      5) e="$(ask_env '重启哪个环境?')"; do_restart "$e" "" ;;
      6) e="$(ask_env '停止哪个环境?')"; do_stop "$e" 0 ;;
      7) do_status all ;;
      8) e="$(ask_env '检测哪个环境?（all=双环境）')"; do_check "$e" ;;
      9) e="$(ask_env '查看哪个环境日志?')"; do_logs "$e" 100 0 ;;
      10) do_install ;;
      11) do_build ;;
      0) log "退出"; exit 0 ;;
      *) warn "无效选项: $choice" ;;
    esac
  done
}

print_help() {
  sed -n '2,16p' "$0"
  printf '\n示例:\n'
  printf '  ./unm-console.sh start --env prod --port 5678\n'
  printf '  ./unm-console.sh restart --env dev\n'
  printf '  ./unm-console.sh check --env all\n'
}

# ---------------- CLI ----------------
CMD="${1:-menu}"; shift || true
OPT_ENV="prod"; OPT_ENV_GIVEN=0; OPT_PORT=""; OPT_FG=0; OPT_FORCE=0; OPT_LINES=100; OPT_FOLLOW=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env|-e) OPT_ENV="${2:-}"; OPT_ENV_GIVEN=1; shift 2 ;;
    --port|-p) OPT_PORT="${2:-}"; shift 2 ;;
    --fg) OPT_FG=1; shift ;;
    --force) OPT_FORCE=1; shift ;;
    --lines|-n) OPT_LINES="${2:-100}"; shift 2 ;;
    --follow|-f) OPT_FOLLOW=1; shift ;;
    -h|--help) print_help; exit 0 ;;
    *) err "未知参数: $1"; print_help; exit 1 ;;
  esac
done

case "$CMD" in
  menu) show_menu ;;
  start)
    if [ "$OPT_FG" = "1" ]; then do_start "$OPT_ENV" fg "$(resolve_port "$OPT_ENV" "$OPT_PORT")"
    else do_start "$OPT_ENV" bg "$(resolve_port "$OPT_ENV" "$OPT_PORT")"; fi ;;
  stop) do_stop "$OPT_ENV" "$OPT_FORCE" ;;
  restart) do_restart "$OPT_ENV" "$OPT_PORT" ;;
  status) if [ "$OPT_ENV_GIVEN" = "1" ]; then do_status "$OPT_ENV"; else do_status all; fi ;;
  check) if [ "$OPT_ENV_GIVEN" = "1" ]; then do_check "$OPT_ENV"; else do_check all; fi ;;
  logs) do_logs "$OPT_ENV" "$OPT_LINES" "$OPT_FOLLOW" ;;
  install) do_install ;;
  build) do_build ;;
  -h|--help|help) print_help ;;
  *) err "未知命令: $CMD"; print_help; exit 1 ;;
esac

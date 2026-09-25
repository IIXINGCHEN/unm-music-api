<# ==============================================================================
# UNM-Server 一键管理控制台 · Windows 版 (PowerShell 5.1+)
# Linux / macOS 请使用同目录的 unm-console.sh（功能对齐）
#
#   生产 / 开发 双环境，支持：启动(前/后台) / 停止 / 重启 / 状态 / 检测配置 / 日志
#
# 首次使用可能需要放行执行策略（管理员或当前用户二选一）:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#
# 用法:
#   .\unm-console.ps1                                  # 交互菜单
#   .\unm-console.ps1 start -Env prod -Port 5678
#   .\unm-console.ps1 start -Env dev -Fg               # 前台启动开发环境
#   .\unm-console.ps1 stop -Env prod
#   .\unm-console.ps1 restart -Env prod
#   .\unm-console.ps1 status                           # 省略 -Env 则显示双环境
#   .\unm-console.ps1 check -Env all                   # 检测配置（9 项自检）
#   .\unm-console.ps1 logs -Env prod -Lines 100 -Follow
#   .\unm-console.ps1 install                          # pnpm install
#   .\unm-console.ps1 build                            # pnpm build（生产包）
# ==============================================================================
param(
  [string]$Command = "menu",
  [string]$Env = "prod",
  [int]$Port = 0,
  [switch]$Fg,
  [switch]$Force,
  [int]$Lines = 100,
  [switch]$Follow
)

$ConsoleVersion = "1.0.0"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir  = Join-Path $ScriptDir ".unm-console"
$PidDir    = Join-Path $StateDir "pids"
$LogDir    = Join-Path $StateDir "logs"
New-Item -ItemType Directory -Force -Path $PidDir, $LogDir | Out-Null

# ---------------- 输出 ----------------
function Write-Info($m) { Write-Host "[unm] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "[FAIL] $m" -ForegroundColor Red }
function Die($m) { Write-Err $m; exit 1 }

# ---------------- .env 读取 ----------------
function Get-DotEnv([string]$Key, [string]$Default = "") {
  $f = Join-Path $ScriptDir ".env"
  $val = ""
  if (Test-Path $f) {
    foreach ($line in Get-Content $f) {
      if ($line -match ("^\s*" + [regex]::Escape($Key) + "\s*=(.*)$")) { $val = $Matches[1] }
    }
    $val = $val.Trim().Trim("'", '"')
  }
  if ([string]::IsNullOrEmpty($val)) { return $Default } else { return $val }
}

# ---------------- 环境 / 端口解析 ----------------
function Resolve-Port([string]$environment, [int]$cliPort) {
  if ($cliPort -gt 0) { return $cliPort }
  if ($environment -eq "dev") {
    $dp = Get-DotEnv "DEV_PORT"
    if ($dp -match '^\d+$') { return [int]$dp }
  }
  $p = Get-DotEnv "PORT" "5678"
  return [int]$p
}
function Resolve-Host() { return (Get-DotEnv "HOST" "127.0.0.1") }
function Test-ValidEnv([string]$e) { return ($e -eq "prod" -or $e -eq "dev") }
function Get-NodeEnv([string]$e) { if ($e -eq "prod") { return "production" } else { return "development" } }

function Get-PidFile([string]$e) { return (Join-Path $PidDir "unm-$e.pid") }
function Get-LogFile([string]$e) { return (Join-Path $LogDir "unm-$e.log") }
function Get-PortFile([string]$e) { return (Join-Path $PidDir "unm-$e.port") }

function Read-Pid([string]$e) {
  $f = Get-PidFile $e
  if (Test-Path $f) { return ((Get-Content $f -Raw).Trim()) } else { return "" }
}
function Write-Pid([string]$e, [string]$v) { Set-Content -Path (Get-PidFile $e) -Value $v -NoNewline }
function Clear-Pid([string]$e) { Remove-Item -Force -ErrorAction SilentlyContinue (Get-PidFile $e) }
function Read-Port([string]$e) {
  $f = Get-PortFile $e
  if (Test-Path $f) { return ((Get-Content $f -Raw).Trim()) } else { return "" }
}
function Write-Port([string]$e, [string]$v) { Set-Content -Path (Get-PortFile $e) -Value $v -NoNewline }
function Clear-Port([string]$e) { Remove-Item -Force -ErrorAction SilentlyContinue (Get-PortFile $e) }
function Get-LivePort([string]$e) {
  $rp = Read-Port $e
  if ($rp -match '^\d+$') { return [int]$rp } else { return (Resolve-Port $e 0) }
}

function Test-PidAlive([string]$pidStr) {
  if ([string]::IsNullOrEmpty($pidStr)) { return $false }
  $p = Get-Process -Id $pidStr -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# ---------------- 端口 / 健康探测 ----------------
function Test-PortInUse([int]$port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(600)) {
      $client.EndConnect($iar)
      $client.Close()
      return $true
    }
  } catch { }
  $client.Close()
  return $false
}

function Get-UrlJson([string]$url) {
  try { return (Invoke-RestMethod -Uri $url -TimeoutSec 3 -ErrorAction Stop) }
  catch { return $null }
}

function Wait-ForHealth([int]$port, [int]$timeoutSec = 20) {
  for ($i = 0; $i -lt $timeoutSec; $i++) {
    $r = Get-UrlJson "http://127.0.0.1:$port/health"
    if ($null -ne $r -and $r.data.status -eq "healthy") { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# 递归结束进程树
function Stop-Tree([int]$pidToKill) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $pidToKill" -ErrorAction SilentlyContinue
  foreach ($c in $children) { Stop-Tree $c.ProcessId }
  Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
}

# ---------------- 启动 ----------------
function Start-Unm([string]$environment, [bool]$fg, [int]$port) {
  if (-not (Test-ValidEnv $environment)) { Die "未知环境: $environment（可选 prod / dev）" }
  if ($port -lt 1 -or $port -gt 65535) { Die "端口非法: $port" }
  $hostName = Resolve-Host
  $nodeEnv  = Get-NodeEnv $environment
  $logFile  = Get-LogFile $environment

  $pidStr = Read-Pid $environment
  if (Test-PidAlive $pidStr) { Write-Err "[$environment] 已在运行 (PID $pidStr)，先 stop 或 restart"; return }
  Clear-Pid $environment; Clear-Port $environment
  if (Test-PortInUse $port) { Write-Err "[$environment] 端口 $port 已被占用，先释放或换 -Port"; return }

  if ($environment -eq "prod") {
    if (-not (Test-Path (Join-Path $ScriptDir "dist/index.js"))) { Die "缺少 dist/index.js，请先运行: .\unm-console.ps1 build" }
    $runTarget = "dist/index.js"
    $runArgs   = "dist/index.js"
  } else {
    $tsxCli = Join-Path $ScriptDir "node_modules/tsx/dist/cli.mjs"
    if (-not (Test-Path $tsxCli)) { Die "缺少 tsx（dev 依赖），请先运行: .\unm-console.ps1 install" }
    if (-not (Test-Path (Join-Path $ScriptDir "src/index.ts"))) { Die "缺少 src/index.ts" }
    $runTarget = $tsxCli
    $runArgs   = "`"$tsxCli`" watch src/index.ts"
  }

  if ($fg) {
    Write-Info "前台启动 [$environment] NODE_ENV=$nodeEnv PORT=$port（Ctrl+C 退出）"
    $env:NODE_ENV = $nodeEnv; $env:PORT = "$port"; $env:HOST = $hostName
    Set-Location $ScriptDir
    if ($environment -eq "dev") { & node.exe $runTarget "watch" "src/index.ts" } else { & node.exe $runTarget }
    return
  }

  Write-Info "后台启动 [$environment] NODE_ENV=$nodeEnv PORT=$port ..."
  # 用 cmd /c 包一层：把 stdout/stderr 合并追加到同一日志文件；cmd 会等待 node 结束，
  # 因此记录的 PID 是 cmd 父进程，停止时按进程树结束即可。
  $inner = "cd /d `"$ScriptDir`" && set NODE_ENV=$nodeEnv && set PORT=$port && set HOST=$hostName && node.exe $runArgs >> `"$logFile`" 2>&1"
  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $inner) -WindowStyle Hidden -PassThru
  Write-Pid $environment "$($proc.Id)"
  Write-Port $environment "$port"

  if (Wait-ForHealth $port 20) {
    Write-Ok "[$environment] 启动成功  PID=$($proc.Id)  http://${hostName}:$port/"
  } else {
    Write-Warn "[$environment] 进程已拉起 (PID $($proc.Id)) 但 20s 内健康检查未通过，查看日志:"
    Get-Content $logFile -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  | $_" }
    Write-Warn "若端口冲突或配置错误，先 .\unm-console.ps1 stop -Env $environment 再排查"
  }
}

# ---------------- 停止 ----------------
function Stop-Unm([string]$environment, [bool]$force) {
  if (-not (Test-ValidEnv $environment)) { Die "未知环境: $environment" }
  $pidStr = Read-Pid $environment

  if (Test-PidAlive $pidStr) {
    Write-Info "停止 [$environment] (PID $pidStr) ..."
    Stop-Tree ([int]$pidStr)
    Start-Sleep -Seconds 2
    Clear-Pid $environment; Clear-Port $environment
    if (Test-PidAlive $pidStr) { Write-Err "[$environment] 停止失败"; return }
    Write-Ok "[$environment] 已停止"
    return
  }
  $port = Get-LivePort $environment
  Clear-Pid $environment; Clear-Port $environment

  if ($force -and (Test-PortInUse $port)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    $killed = $false
    foreach ($c in $conns) {
      Write-Warn "按端口 $port 反查到 PID $($c.OwningProcess)，强制结束"
      Stop-Tree $c.OwningProcess
      $killed = $true
    }
    Start-Sleep -Seconds 2
    if (Test-PortInUse $port) { Write-Err "端口 $port 仍被占用"; return }
    if ($killed) { Write-Ok "端口 $port 已释放" }
    return
  }
  if (Test-PortInUse $port) {
    Write-Warn "[$environment] 无 PID 记录，但端口 $port 仍被占用（可能手动启动）。加 -Force 按端口强杀，或手动处理。"
    return
  }
  Write-Info "[$environment] 未在运行"
}

# ---------------- 重启 ----------------
function Restart-Unm([string]$environment, [int]$cliPort) {
  if (-not (Test-ValidEnv $environment)) { Die "未知环境: $environment" }
  $port = Resolve-Port $environment $cliPort
  Write-Info "重启 [$environment] ..."
  Stop-Unm $environment $false
  Start-Sleep -Seconds 1
  Start-Unm $environment $false $port
}

# ---------------- 状态 ----------------
function Show-Status([string]$environment) {
  if (@("prod", "dev", "all") -notcontains $environment) { Write-Err "未知环境: $environment（可选 prod / dev / all）"; return }
  Write-Host "UNM-Server 运行状态" -ForegroundColor White
  $fmt = "{0,-6} {1,-8} {2,-7} {3,-6} {4}"
  Write-Host ($fmt -f "环境", "PID", "端口", "健康", "版本/运行时长")
  foreach ($target in @("prod", "dev")) {
    if ($environment -ne "all" -and $environment -ne $target) { continue }
    $pidStr = Read-Pid $target
    $port   = Get-LivePort $target
    $health = "-"; $ver = "-"; $up = "-"
    if (Test-PidAlive $pidStr) {
      $info = Get-UrlJson "http://127.0.0.1:$port/info"
      if ($null -ne $info) {
        $health = "UP"; $ver = $info.data.version; $up = "$($info.data.uptime)s"
      } else {
        $health = "无响应"; $pidStr = "$pidStr?"
      }
    } else {
      $pidStr = "-"
      if (Test-PortInUse $port) { $health = "端口占用" }
    }
    Write-Host ($fmt -f $target, $pidStr, $port, $health, "$ver $up")
  }
}

# ---------------- 检测配置（9 项自检） ----------------
function Test-Config([string]$environment) {
  if (@("prod", "dev", "all") -notcontains $environment) { Write-Err "未知环境: $environment（可选 prod / dev / all）"; return }
  $script:fail = 0; $script:warnN = 0
  Write-Host "UNM-Server 配置检测（环境: $environment）" -ForegroundColor White
  Write-Host "---- ----------------------------------------"
  function Pass($m) { Write-Ok $m }
  function WarnC($m) { Write-Warn $m; $script:warnN++ }
  function FailC($m) { Write-Err $m; $script:fail++ }

  # 1. Node.js
  $nodeOk = $false
  try {
    $nv = (node --version 2>$null).TrimStart("v")
    $major = [int]($nv.Split(".")[0])
    if ($major -ge 18) { Pass "1. Node.js v$nv (>=18)"; $nodeOk = $true } else { FailC "1. Node.js v$nv 过低，需要 >=18" }
  } catch { FailC "1. Node.js 不可用" }

  # 2. pnpm
  try { $pv = (pnpm --version 2>$null).Trim(); Pass "2. pnpm $pv 可用" }
  catch { WarnC "2. 未找到 pnpm（如需 install/build 请先安装，或 corepack enable）" }

  # 3. 依赖
  if ((Test-Path (Join-Path $ScriptDir "node_modules")) -and (Test-Path (Join-Path $ScriptDir "package.json"))) {
    Pass "3. node_modules 已安装"
  } else { FailC "3. node_modules 缺失，请运行: .\unm-console.ps1 install" }

  # 4. 运行载体
  if ($environment -eq "prod" -or $environment -eq "all") {
    if (Test-Path (Join-Path $ScriptDir "dist/index.js")) { Pass "4a. 生产包 dist/index.js 存在" }
    else { FailC "4a. 生产包缺失，请运行: .\unm-console.ps1 build" }
  }
  if ($environment -eq "dev" -or $environment -eq "all") {
    if (Test-Path (Join-Path $ScriptDir "node_modules/tsx/dist/cli.mjs")) { Pass "4b. tsx 可用（开发环境热重载）" }
    else { FailC "4b. tsx 缺失，请运行: .\unm-console.ps1 install" }
  }

  # 5. .env 字段合法性
  if (-not (Test-Path (Join-Path $ScriptDir ".env"))) {
    WarnC "5. 未找到 .env，将使用内置默认配置（如需自定义请复制 .env.example 为 .env）"
  } else {
    $bad = $false
    foreach ($pn in @("PORT", "DEV_PORT")) {
      $v = Get-DotEnv $pn
      if ($v -ne "" -and $v -notmatch '^\d+$') { FailC "5. $pn 非法: $v"; $bad = $true }
      elseif ($v -ne "" -and ([int]$v -lt 1 -or [int]$v -gt 65535)) { FailC "5. $pn 超出范围: $v"; $bad = $true }
    }
    $ne = Get-DotEnv "NODE_ENV"
    if ($ne -ne "" -and @("production", "development", "test") -notcontains $ne) { FailC "5. NODE_ENV 非法: $ne"; $bad = $true }
    foreach ($bf in @("ENABLE_FLAC", "SELECT_MAX_BR", "FOLLOW_SOURCE_ORDER", "SEARCH_ALBUM", "ENABLE_RATE_LIMIT")) {
      $bv = Get-DotEnv $bf
      if ($bv -ne "" -and @("true", "false") -notcontains $bv) { FailC "5. $bf 应为 true/false，实际: $bv"; $bad = $true }
    }
    foreach ($nf in @("REQUEST_TIMEOUT", "CACHE_MAX_SIZE", "DEFAULT_BITRATE", "DEFAULT_SEARCH_COUNT")) {
      $nv2 = Get-DotEnv $nf
      if ($nv2 -ne "" -and $nv2 -notmatch '^\d+$') { FailC "5. $nf 应为数字，实际: $nv2"; $bad = $true }
    }
    $gu = Get-DotEnv "GDSTUDIO_API_URL"
    if ($gu -ne "" -and $gu -notmatch '^https?://') { FailC "5. GDSTUDIO_API_URL 非法: $gu"; $bad = $true }
    if (-not $bad) { Pass "5. .env 字段校验通过" }
  }

  # 6. 端口可用性
  foreach ($target in @("prod", "dev")) {
    if ($environment -ne "all" -and $environment -ne $target) { continue }
    $tp = Resolve-Port $target 0
    if (Test-PortInUse $tp) { WarnC "6. [$target] 端口 $tp 已被占用" } else { Pass "6. [$target] 端口 $tp 空闲" }
  }

  # 7. 上游 API 可达性
  $gu2 = Get-DotEnv "GDSTUDIO_API_URL" "https://music-api.gdstudio.xyz/api.php"
  try {
    Invoke-WebRequest -Uri $gu2 -Method Head -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop | Out-Null
    Pass "7. 上游 GDSTUDIO_API_URL 可达"
  } catch { WarnC "7. 上游 GDSTUDIO_API_URL 不可达（网络/代理问题，服务仍可启动但解析可能失败）" }

  # 8. 状态目录可写
  try {
    $t = Join-Path $StateDir ".w"; Set-Content -Path $t -Value "x" -NoNewline; Remove-Item $t -Force
    Pass "8. 状态目录可写 ($StateDir)"
  } catch { FailC "8. 状态目录不可写: $StateDir" }

  # 9. tailwindcss
  $tw1 = Join-Path $ScriptDir "node_modules/.bin/tailwindcss.cmd"
  $tw2 = Join-Path $ScriptDir "node_modules/.bin/tailwindcss"
  if ((Test-Path $tw1) -or (Test-Path $tw2)) { Pass "9. tailwindcss 可用" }
  else { WarnC "9. tailwindcss 缺失（build 时会自动处理，或先 install）" }

  Write-Host "---- ----------------------------------------"
  if ($script:fail -gt 0) { Write-Err "检测完成: $($script:fail) 项失败，$($script:warnN) 项警告 —— 请先修复失败项"; exit 1 }
  elseif ($script:warnN -gt 0) { Write-Warn "检测完成: 0 项失败，$($script:warnN) 项警告 —— 可启动，建议处理警告" }
  else { Write-Ok "检测完成: 全部通过，可以启动" }
}

# ---------------- 日志 ----------------
function Show-Logs([string]$environment, [int]$lines, [bool]$follow) {
  if (-not (Test-ValidEnv $environment)) { Die "未知环境: $environment" }
  $f = Get-LogFile $environment
  if (-not (Test-Path $f)) { Die "暂无日志: $f（服务未启动过）" }
  if ($follow) {
    Write-Info "实时跟踪 [$environment] 日志（Ctrl+C 退出）: $f"
    Get-Content $f -Tail $lines -Wait
  } else {
    Get-Content $f -Tail $lines
  }
}

# ---------------- 安装依赖 / 构建 ----------------
function Install-Deps() {
  Set-Location $ScriptDir
  try { pnpm --version 2>$null | Out-Null }
  catch {
    Write-Warn "未找到 pnpm，尝试 corepack 启用..."
    corepack enable 2>$null; corepack prepare pnpm@latest --activate 2>$null
    try { pnpm --version 2>$null | Out-Null } catch { Die "pnpm 不可用，请手动安装 Node.js LTS + pnpm" }
  }
  Write-Info "安装依赖 (pnpm install) ..."
  pnpm install
  if ($LASTEXITCODE -ne 0) { Die "pnpm install 失败" }
  Write-Ok "依赖安装完成"
}

function Build-Prod() {
  Set-Location $ScriptDir
  try { pnpm --version 2>$null | Out-Null } catch { Die "缺少 pnpm，请先运行: .\unm-console.ps1 install" }
  Write-Info "构建生产包 (pnpm build: 版本同步 + tailwind + tsup) ..."
  pnpm build
  if ($LASTEXITCODE -ne 0) { Die "pnpm build 失败" }
  Write-Ok "构建完成: dist/index.js"
}

# ---------------- 交互菜单 ----------------
function Ask-Env([string]$prompt) {
  $ans = Read-Host "$prompt [prod/dev，默认 prod]"
  if ($ans -eq "dev" -or $ans -eq "d") { return "dev" } else { return "prod" }
}

function Show-Menu() {
  while ($true) {
    Write-Host ""
    Write-Host "==== UNM-Server 一键控制台 v$ConsoleVersion ====" -ForegroundColor White
    Write-Host "  1) 启动生产环境 (后台)"
    Write-Host "  2) 启动生产环境 (前台)"
    Write-Host "  3) 启动开发环境 (后台)"
    Write-Host "  4) 启动开发环境 (前台)"
    Write-Host "  5) 重启服务"
    Write-Host "  6) 停止服务"
    Write-Host "  7) 查看状态"
    Write-Host "  8) 检测配置"
    Write-Host "  9) 查看日志"
    Write-Host " 10) 安装依赖"
    Write-Host " 11) 构建生产包"
    Write-Host "  0) 退出"
    $choice = Read-Host "请选择"
    switch ($choice) {
      "1" { Start-Unm "prod" $false (Resolve-Port "prod" 0) }
      "2" { Start-Unm "prod" $true (Resolve-Port "prod" 0) }
      "3" { Start-Unm "dev" $false (Resolve-Port "dev" 0) }
      "4" { Start-Unm "dev" $true (Resolve-Port "dev" 0) }
      "5" { $e = Ask-Env "重启哪个环境?"; Restart-Unm $e 0 }
      "6" { $e = Ask-Env "停止哪个环境?"; Stop-Unm $e $false }
      "7" { Show-Status "all" }
      "8" { $ce = Read-Host "检测哪个环境? [prod/dev/all，默认 all]"; if ([string]::IsNullOrEmpty($ce)) { $ce = "all" }; Test-Config $ce }
      "9" { $e = Ask-Env "查看哪个环境日志?"; Show-Logs $e 100 $false }
      "10" { Install-Deps }
      "11" { Build-Prod }
      "0" { Write-Info "退出"; exit 0 }
      default { Write-Warn "无效选项: $choice" }
    }
  }
}

# ---------------- 分发 ----------------
switch ($Command.ToLower()) {
  "menu"    { Show-Menu }
  "start"   { Start-Unm $Env ([bool]$Fg) (Resolve-Port $Env $Port) }
  "stop"    { Stop-Unm $Env ([bool]$Force) }
  "restart" { Restart-Unm $Env $Port }
  "status"  { if ($PSBoundParameters.ContainsKey("Env")) { Show-Status $Env } else { Show-Status "all" } }
  "check"   { if ($PSBoundParameters.ContainsKey("Env")) { Test-Config $Env } else { Test-Config "all" } }
  "logs"    { Show-Logs $Env $Lines ([bool]$Follow) }
  "install" { Install-Deps }
  "build"   { Build-Prod }
  "help"    { Get-Content $MyInvocation.MyCommand.Path | Select-Object -First 18 }
  default   { Write-Err "未知命令: $Command"; exit 1 }
}

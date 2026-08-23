/**
 * UNM-Server 前端核心模块：主题切换 / Toast 通知 / 服务探活 / 移动端抽屉 / 折叠系统 / 版本徽章同步。
 * 经典脚本加载（非 ES Module），顶层声明为页面全局，供 player / catalog / workbench 复用。
 */

    // --- 页面启动引导 ---
    document.querySelectorAll('.current-year-text').forEach(el => el.textContent = new Date().getFullYear());
    lucide.createIcons();

    // --- 主题切换 ---
    const themeToggle = document.getElementById('themeToggle');
    function setTheme(isDark) {
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      lucide.createIcons();
    }
    const savedTheme = localStorage.getItem('theme');
    setTheme(savedTheme !== 'light');
    themeToggle.addEventListener('click', () => setTheme(!document.documentElement.classList.contains('dark')));

    // --- Toast 提示 ---
    function showToast({ type = 'info', title = '提示', message = '' }) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'p-3.5 sm:p-4 rounded-2xl bg-slate-900/95 border shadow-2xl text-white flex items-start space-x-3 pointer-events-auto backdrop-blur-xl transition-all duration-300 transform translate-y-2 opacity-0 ' +
        (type === 'success' ? 'border-emerald-500/40 text-emerald-300' :
         type === 'error' ? 'border-rose-500/40 text-rose-300' :
         type === 'warning' ? 'border-amber-500/40 text-amber-300' :
         'border-sky-500/40 text-sky-300');
      const iconName = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'info';
      toast.innerHTML = `
        <div class="mt-0.5 flex-shrink-0"><i data-lucide="${iconName}" class="w-5 h-5"></i></div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xs sm:text-sm text-white truncate">${title}</div>
          <div class="text-[11px] sm:text-xs text-slate-300 mt-0.5 break-words">${message}</div>
        </div>`;
      container.appendChild(toast);
      lucide.createIcons();
      requestAnimationFrame(() => toast.classList.remove('translate-y-2', 'opacity-0'));
      setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // --- 服务 Ping 探活 ---
    async function checkHealthPing() {
      const startTime = performance.now();
      try {
        const res = await fetch('/ping');
        const latency = Math.round(performance.now() - startTime);
        if (res.ok) document.getElementById('pingText').textContent = `Ping: ${latency}ms`;
      } catch (e) {
        document.getElementById('pingText').textContent = 'Offline';
      }
    }
    checkHealthPing();
    setInterval(checkHealthPing, 10000);

    // --- 移动端抽屉 ---
    function toggleMobileDrawer() {
      const drawer = document.getElementById('mobileDrawer');
      drawer.classList.toggle('hidden');
      drawer.classList.toggle('flex');
    }

    // --- 折叠系统 (纯 SVG 表格图标) ---
    function bindCollapse(btnId, iconId, bodyId, stateKey) {
      window[stateKey] = false;
      return function toggle() {
        window[stateKey] = !window[stateKey];
        const body = document.getElementById(bodyId);
        const icon = document.getElementById(iconId);
        const btn = document.getElementById(btnId);
        if (window[stateKey]) {
          body.classList.add('hidden');
          icon.classList.add('rotate-180');
          btn.title = '展开表格';
        } else {
          body.classList.remove('hidden');
          icon.classList.remove('rotate-180');
          btn.title = '折叠表格';
        }
        lucide.createIcons();
      };
    }
    const togglePlaylistStation = bindCollapse('btnPlaylistToggle', 'iconPlaylistToggle', 'playlistStationBody', '_playlistCollapsed');
    const toggleWorkbenchStation = bindCollapse('btnWorkbenchToggle', 'iconWorkbenchToggle', 'workbenchStationBody', '_workbenchCollapsed');
    const toggleSpecsTable = bindCollapse('btnSpecsToggle', 'iconSpecsToggle', 'specsTableContent', '_specsCollapsed');

    // 从后端 /info 同步统一版本号徽章（版本由根目录 VERSION 文件单点管理）
    async function syncAppVersionBadge() {
      try {
        const res = await fetch('/info');
        const json = await res.json();
        const v = json?.data?.version;
        if (v) {
          document.querySelectorAll('.app-version-badge').forEach(el => {
            el.textContent = `v${v} PRO`;
          });
        }
      } catch (e) { /* 静态兜底文本保持不变 */ }
    }
    syncAppVersionBadge();

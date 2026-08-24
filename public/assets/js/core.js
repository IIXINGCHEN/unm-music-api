/**
 * UNM-Server 前端核心模块：主题切换 / Toast 通知 / 服务探活 / 移动端抽屉 / 折叠系统 / 版本徽章同步。
 * 经典脚本加载（非 ES Module），顶层声明为页面全局，供 player / catalog / workbench 复用。
 */

    // --- 页面启动引导 ---
    document.querySelectorAll('.current-year-text').forEach(el => el.textContent = new Date().getFullYear());
    lucide.createIcons();

    // --- 主题切换系统 (防刷新闪烁设计) ---
    const themeToggle = document.getElementById('themeToggle');
    function setTheme(isDark, animate = false) {
      if (animate) {
        document.documentElement.classList.add('theme-transitioning');
      }
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      lucide.createIcons();
      if (animate) {
        setTimeout(() => {
          document.documentElement.classList.remove('theme-transitioning');
        }, 320);
      }
    }
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const nextDark = !document.documentElement.classList.contains('dark');
        setTheme(nextDark, true);
      });
    }

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

    // --- 灵动岛交互中枢 (Dynamic Island Controller) ---
    let isIslandExpanded = false;

    function toggleDynamicIsland() {
      if (isIslandExpanded) {
        collapseDynamicIsland();
      } else {
        expandDynamicIsland();
      }
    }

    function expandDynamicIsland() {
      const island = document.getElementById('dynamicIsland');
      const compactView = document.getElementById('islandCompactView');
      const expandedView = document.getElementById('islandExpandedView');
      if (!island || !compactView || !expandedView) return;

      isIslandExpanded = true;
      island.classList.remove('dynamic-island-compact');
      island.classList.add('dynamic-island-expanded', 'p-4', 'sm:p-6');
      compactView.classList.add('hidden');
      expandedView.classList.remove('hidden');
      lucide.createIcons();
    }

    function collapseDynamicIsland() {
      const island = document.getElementById('dynamicIsland');
      const compactView = document.getElementById('islandCompactView');
      const expandedView = document.getElementById('islandExpandedView');
      if (!island || !compactView || !expandedView) return;

      isIslandExpanded = false;
      island.classList.remove('dynamic-island-expanded', 'p-4', 'sm:p-6');
      island.classList.add('dynamic-island-compact');
      expandedView.classList.add('hidden');
      compactView.classList.remove('hidden');
      lucide.createIcons();
    }

    // 点击灵动岛外部自动优雅收起
    document.addEventListener('click', (e) => {
      const island = document.getElementById('dynamicIsland');
      if (isIslandExpanded && island && !island.contains(e.target)) {
        collapseDynamicIsland();
      }
    });

    // 播放器状态同步到灵动岛（歌曲名、歌手、声波律动）
    window.syncIslandMusicState = function(track, isPlaying) {
      const musicPill = document.getElementById('islandMusicPill');
      const staticNav = document.getElementById('islandStaticNav');
      const titleEl = document.getElementById('islandTrackTitle');
      const wavesEl = document.getElementById('islandAudioWaves');

      if (!musicPill || !staticNav) return;

      if (track && (track.name || track.id)) {
        staticNav.classList.add('hidden');
        musicPill.classList.remove('hidden');
        musicPill.classList.add('flex');
        if (titleEl) {
          titleEl.textContent = `${track.name || '正在播放'} - ${track.artist || 'UNM'}`;
        }
        if (wavesEl) {
          wavesEl.style.opacity = isPlaying ? '1' : '0.35';
        }
      } else {
        musicPill.classList.add('hidden');
        musicPill.classList.remove('flex');
        staticNav.classList.remove('hidden');
      }
      lucide.createIcons();
    };

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
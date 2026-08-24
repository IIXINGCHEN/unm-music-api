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

    // --- 服务 Ping 探活 (多端智能延迟感知) ---
    async function checkHealthPing() {
      const startTime = performance.now();
      const pingEl = document.getElementById('pingText');
      const mobilePingEl = document.getElementById('mobilePingText');
      const pingBadges = document.querySelectorAll('#pingBadge, #mobilePingBadge');
      try {
        const res = await fetch('/ping');
        const latency = Math.round(performance.now() - startTime);
        const text = res.ok ? `${latency}ms` : 'Degraded';
        if (pingEl) pingEl.textContent = `Ping: ${text}`;
        if (mobilePingEl) mobilePingEl.textContent = `Ping: ${text}`;

        pingBadges.forEach(badge => {
          badge.classList.remove('bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-500/20',
            'bg-amber-500/10', 'text-amber-600', 'dark:text-amber-400', 'border-amber-500/20',
            'bg-rose-500/10', 'text-rose-600', 'dark:text-rose-400', 'border-rose-500/20');
          if (res.ok && latency < 80) {
            badge.classList.add('bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400', 'border-emerald-500/20');
          } else if (res.ok && latency < 200) {
            badge.classList.add('bg-amber-500/10', 'text-amber-600', 'dark:text-amber-400', 'border-amber-500/20');
          } else {
            badge.classList.add('bg-rose-500/10', 'text-rose-600', 'dark:text-rose-400', 'border-rose-500/20');
          }
        });
      } catch (e) {
        if (pingEl) pingEl.textContent = 'Offline';
        if (mobilePingEl) mobilePingEl.textContent = 'Offline';
      }
    }
    checkHealthPing();
    setInterval(checkHealthPing, 10000);

    // --- 移动端导航抽屉 (平滑微动效与外部点击关闭) ---
    function toggleMobileDrawer(forceClose = false) {
      const drawer = document.getElementById('mobileDrawer');
      const icon = document.getElementById('mobileMenuIcon');
      if (!drawer) return;

      const isOpening = forceClose ? false : drawer.classList.contains('hidden');
      if (isOpening) {
        drawer.classList.remove('hidden');
        drawer.classList.add('flex', 'mobile-drawer-animated');
        if (icon) icon.setAttribute('data-lucide', 'x');
      } else {
        drawer.classList.add('hidden');
        drawer.classList.remove('flex', 'mobile-drawer-animated');
        if (icon) icon.setAttribute('data-lucide', 'menu');
      }
      lucide.createIcons();
    }

    // 点击页面任意外部区域自动收起移动端导航抽屉
    document.addEventListener('click', (e) => {
      const drawer = document.getElementById('mobileDrawer');
      const toggleBtn = e.target.closest('[onclick*="toggleMobileDrawer"]');
      if (drawer && !drawer.classList.contains('hidden') && !drawer.contains(e.target) && !toggleBtn) {
        toggleMobileDrawer(true);
      }
    });

    // 滚动监听与导航高亮联动 (ScrollSpy)
    function initNavScrollSpy() {
      const navLinks = document.querySelectorAll('header nav a.nav-pill-item');
      if (!navLinks.length) return;
      const sections = ['playlist-station', 'workbench', 'providers'];

      window.addEventListener('scroll', () => {
        const scrollY = window.scrollY + 140;
        let currentSection = '';

        for (const secId of sections) {
          const el = document.getElementById(secId);
          if (el) {
            const top = el.offsetTop;
            const height = el.offsetHeight;
            if (scrollY >= top && scrollY < top + height) {
              currentSection = secId;
              break;
            }
          }
        }

        navLinks.forEach(link => {
          const href = link.getAttribute('href') || '';
          if (currentSection && (href === `#${currentSection}` || href === `/#${currentSection}`)) {
            link.classList.add('active');
          } else if (href.startsWith('#') || href.startsWith('/#')) {
            link.classList.remove('active');
          }
        });
      }, { passive: true });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initNavScrollSpy);
    } else {
      initNavScrollSpy();
    }

    // 快速定位至音乐播放器
    window.scrollToPlayer = function() {
      const playerBar = document.getElementById('playerBar');
      if (playerBar) {
        playerBar.scrollIntoView({ behavior: 'smooth', block: 'end' });
        playerBar.classList.add('ring-2', 'ring-sky-500');
        setTimeout(() => playerBar.classList.remove('ring-2', 'ring-sky-500'), 1500);
      }
    };

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

    // 播放器状态同步到导航栏（歌曲名、歌手、声波律动）
    window.syncIslandMusicState = function(track, isPlaying) {
      const musicPill = document.getElementById('islandMusicPill');
      const titleEl = document.getElementById('islandTrackTitle');
      const wavesEl = document.getElementById('islandAudioWaves');

      if (!musicPill) return;

      if (track && (track.name || track.id)) {
        musicPill.classList.remove('hidden');
        musicPill.classList.add('flex');
        if (titleEl) {
          titleEl.textContent = `${track.name || '正在播放'}`;
        }
        if (wavesEl) {
          wavesEl.style.opacity = isPlaying ? '1' : '0.35';
        }
      } else {
        musicPill.classList.add('hidden');
        musicPill.classList.remove('flex');
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
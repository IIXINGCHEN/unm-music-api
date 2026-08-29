/**
 * UNM-Server 前端核心模块：主题切换 / Toast 通知 / 服务探活 / 移动端抽屉 / 折叠系统 / 版本徽章同步。
 * 经典脚本加载（非 ES Module），顶层声明为页面全局，供 player / catalog / workbench 复用。
 */

    // --- 页面启动引导 ---
    document.querySelectorAll('.current-year-text').forEach(el => el.textContent = new Date().getFullYear());
    lucide.createIcons();

    // --- 主题切换系统：实现见共享模块 theme.js ---
    initThemeSystem();

    // --- XSS 防护：全局 HTML 转义助手（文本节点与双/单引号属性上下文通用） ---
    window.escapeHtml = function(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

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
      // 标题/消息可能携带上游错误文本或用户输入：骨架 innerHTML 固定，动态内容一律 textContent 注入
      toast.innerHTML = `
        <div class="mt-0.5 flex-shrink-0"><i data-lucide="${iconName}" class="w-5 h-5"></i></div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xs sm:text-sm text-white truncate js-toast-title"></div>
          <div class="text-[11px] sm:text-xs text-slate-300 mt-0.5 break-words js-toast-message"></div>
        </div>`;
      toast.querySelector('.js-toast-title').textContent = title;
      toast.querySelector('.js-toast-message').textContent = message;
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
/**
 * UNM-Server 404 页脚本：年份填充、版本同步、图标初始化、移动端抽屉与主题切换。
 */

    document.querySelectorAll('.current-year-text').forEach(el => el.textContent = String(new Date().getFullYear()));
    fetch('/info').then(r => r.json()).then(j => {
      if (j?.data?.version) {
        document.querySelectorAll('.app-version-badge').forEach(el => el.textContent = `v${j.data.version} PRO`);
      }
    }).catch(() => {});
    lucide.createIcons();

    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    function setTheme(isDark, animate = false, event = null) {
      const applyTheme = () => {
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      };

      if (animate && typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const btn = themeToggle || (event?.currentTarget || event?.target);
        const rect = btn?.getBoundingClientRect?.();
        const x = event?.clientX || (rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
        const y = event?.clientY || (rect ? rect.top + rect.height / 2 : 0);
        const endRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y)
        );

        const transition = document.startViewTransition(() => {
          applyTheme();
        });

        transition.ready.then(() => {
          const clipPath = [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
          ];
          document.documentElement.animate(
            {
              clipPath: isDark ? clipPath : [...clipPath].reverse()
            },
            {
              duration: 360,
              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
              pseudoElement: isDark ? '::view-transition-new(root)' : '::view-transition-old(root)'
            }
          );
        }).catch(() => {
          applyTheme();
        });
        return;
      }

      applyTheme();
    }

    if (themeToggle) {
      themeToggle.addEventListener('click', (e) => {
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(!isDark, true, e);
      });
    }

    // 移动端导航抽屉
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

    document.addEventListener('click', (e) => {
      const drawer = document.getElementById('mobileDrawer');
      const toggleBtn = e.target.closest('[onclick*="toggleMobileDrawer"]');
      if (drawer && !drawer.classList.contains('hidden') && !drawer.contains(e.target) && !toggleBtn) {
        toggleMobileDrawer(true);
      }
    });

    window.toggleMobileDrawer = toggleMobileDrawer;
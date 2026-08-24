/**
 * UNM-Server 404 页脚本：年份填充、版本同步、图标初始化与主题切换。
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

    function setTheme(isDark, animate = false) {
      if (animate) document.documentElement.classList.add('theme-transitioning');
      document.documentElement.classList.toggle('dark', isDark);
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      lucide.createIcons();
      if (animate) {
        setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 320);
      }
    }

    // --- 灵动岛交互中枢 (Dynamic Island Controller) ---
    let isIslandExpanded = false;

    window.toggleDynamicIsland = function() {
      if (isIslandExpanded) {
        window.collapseDynamicIsland();
      } else {
        window.expandDynamicIsland();
      }
    };

    window.expandDynamicIsland = function() {
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
    };

    window.collapseDynamicIsland = function() {
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
    };

    // 点击灵动岛外部自动收起
    document.addEventListener('click', (e) => {
      const island = document.getElementById('dynamicIsland');
      if (isIslandExpanded && island && !island.contains(e.target)) {
        window.collapseDynamicIsland();
      }
    });

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(!isDark, true);
      });
    }
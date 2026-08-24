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

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.contains('dark');
        setTheme(!isDark, true);
      });
    }
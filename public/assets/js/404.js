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

    // 主题切换实现见共享模块 theme.js
    initThemeSystem();

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
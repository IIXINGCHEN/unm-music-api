/**
 * UNM-Server 共享移动端导航抽屉：开合动画、图标切换与点击外部自动收起。
 * 经典脚本加载（非 ES Module），挂载 window.toggleMobileDrawer 供页面 onclick 调用。
 */
(function () {
  'use strict';

  function toggleMobileDrawer(forceClose) {
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
    if (window.lucide) window.lucide.createIcons();
  }

  window.toggleMobileDrawer = toggleMobileDrawer;

  // 点击页面任意外部区域自动收起抽屉（跳过抽屉内部与切换按钮本身）
  document.addEventListener('click', (e) => {
    const drawer = document.getElementById('mobileDrawer');
    const toggleBtn = e.target.closest('[onclick*="toggleMobileDrawer"]');
    if (drawer && !drawer.classList.contains('hidden') && !drawer.contains(e.target) && !toggleBtn) {
      toggleMobileDrawer(true);
    }
  });
})();

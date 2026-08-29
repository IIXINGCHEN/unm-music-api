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

    // 主题切换与移动端抽屉实现见共享模块 theme.js / drawer.js
    initThemeSystem();
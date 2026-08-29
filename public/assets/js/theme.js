/**
 * UNM-Server 共享主题模块：深浅色持久化 + View Transitions 圆波扩散切换。
 * 经典脚本加载（非 ES Module），挂载 window.initThemeSystem 供各页面复用；
 * 页面头部内联引导脚本负责首帧 class 同步，本模块只接管后续切换。
 */
(function () {
  'use strict';

  function setTheme(isDark, onChange, animate, event) {
    var applyTheme = function () {
      document.documentElement.classList.toggle('dark', isDark);
      try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) {}
      if (onChange) onChange(isDark);
    };

    if (animate && typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var btn = document.getElementById('themeToggle') || (event && (event.currentTarget || event.target));
      var rect = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
      var x = (event && event.clientX) || (rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
      var y = (event && event.clientY) || (rect ? rect.top + rect.height / 2 : 0);
      var endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      var transition = document.startViewTransition(applyTheme);
      transition.ready.then(function () {
        var clipPath = [
          'circle(0px at ' + x + 'px ' + y + 'px)',
          'circle(' + endRadius + 'px at ' + x + 'px ' + y + 'px)'
        ];
        document.documentElement.animate(
          { clipPath: isDark ? clipPath : clipPath.slice().reverse() },
          {
            duration: 360,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            pseudoElement: isDark ? '::view-transition-new(root)' : '::view-transition-old(root)'
          }
        );
      }).catch(applyTheme);
      return;
    }

    applyTheme();
  }

  window.setTheme = setTheme;

  /**
   * 接管页面主题切换按钮。
   * options.onChange: 应用新主题后的回调（如大盘的 updateChartTheme）。
   */
  window.initThemeSystem = function (options) {
    var opts = options || {};
    var toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        var nextDark = !document.documentElement.classList.contains('dark');
        setTheme(nextDark, opts.onChange || null, true, e);
      });
    }
  };
})();

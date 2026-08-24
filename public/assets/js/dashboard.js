/**
 * UNM-Server 遥测大盘交互模块：Toast、鉴权凭证、折叠布局、Chart.js 图表矩阵、
 * 轮询控制、遥测表格渲染与明细抽屉。依赖 vendor/lucide 与 vendor/chart.umd。
 */

document.getElementById('year').textContent = new Date().getFullYear();
    lucide.createIcons();

    // 现代 Toast 通知系统
    function showToast({ type = 'info', title = '', message = '', duration = 3000 }) {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
      toast.id = id;

      let iconHtml = '<i data-lucide="info" class="w-5 h-5 text-sky-500"></i>';
      let borderClass = 'border-sky-500/20';

      if (type === 'success') {
        iconHtml = '<i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-500"></i>';
        borderClass = 'border-emerald-500/20';
      } else if (type === 'error') {
        iconHtml = '<i data-lucide="alert-circle" class="w-5 h-5 text-rose-500"></i>';
        borderClass = 'border-rose-500/20';
      } else if (type === 'warning') {
        iconHtml = '<i data-lucide="alert-triangle" class="w-5 h-5 text-amber-500"></i>';
        borderClass = 'border-amber-500/20';
      }

      toast.className = `glass-panel bg-white/95 dark:bg-slate-900/95 border ${borderClass} shadow-2xl px-4 py-3.5 rounded-2xl flex items-start space-x-3.5 pointer-events-auto transform translate-x-12 opacity-0 transition-all duration-300 ease-out max-w-md`;
      toast.innerHTML = `
        <div class="flex-shrink-0 mt-0.5">${iconHtml}</div>
        <div class="flex-1 text-sm">
          ${title ? `<div class="font-bold text-slate-900 dark:text-white mb-0.5">${title}</div>` : ''}
          <div class="text-slate-600 dark:text-slate-300 leading-relaxed">${message}</div>
        </div>
        <button onclick="dismissToast('${id}')" class="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 interactive-btn">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      `;

      container.appendChild(toast);
      lucide.createIcons();

      requestAnimationFrame(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
      });

      if (duration > 0) {
        setTimeout(() => dismissToast(id), duration);
      }
    }

    function dismissToast(id) {
      const toast = document.getElementById(id);
      if (!toast) return;
      toast.classList.remove('translate-x-0', 'opacity-100');
      toast.classList.add('translate-x-12', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }

    // 0. API Key 管理逻辑
    function getStoredApiKey() {
      return localStorage.getItem('unm_monitor_api_key') || '';
    }

    function openApiKeyModal() {
      const modal = document.getElementById('apiKeyModal');
      document.getElementById('inputApiKeyModal').value = getStoredApiKey();
      modal.classList.remove('hidden');
      lucide.createIcons();
    }

    function closeApiKeyModal() {
      document.getElementById('apiKeyModal').classList.add('hidden');
    }

    function saveApiKey() {
      const val = document.getElementById('inputApiKeyModal').value.trim();
      localStorage.setItem('unm_monitor_api_key', val);
      closeApiKeyModal();
      showToast({ type: 'success', title: '凭证已保存', message: 'API Key 已更新，正在重新加载数据...' });
      loadDashboardData(1);
    }

    function clearSavedApiKey() {
      localStorage.removeItem('unm_monitor_api_key');
      document.getElementById('inputApiKeyModal').value = '';
      closeApiKeyModal();
      showToast({ type: 'info', title: '凭证已清除', message: '已移除本地保存的 API Key' });
      loadDashboardData(1);
    }

    function getAuthHeaders() {
      const key = getStoredApiKey();
      return key ? { 'x-api-key': key } : {};
    }

    // 1. 折叠与展开控制 (Collapsible Sections)
    const sectionStates = {
      kpis: true,
      charts: true,
      logs: true,
    };

    function toggleSection(sec) {
      sectionStates[sec] = !sectionStates[sec];
      const content = document.getElementById(`content${capitalize(sec)}`);
      const icon = document.getElementById(`iconToggle${capitalize(sec)}`);
      const label = document.getElementById(`labelToggle${capitalize(sec)}`);

      if (sectionStates[sec]) {
        content.classList.remove('hidden');
        icon.classList.remove('rotate-180');
        label.textContent = sec === 'logs' ? '收起表格' : '收起面板';
        showToast({ type: 'info', title: '面板展开', message: `已展开 ${sec.toUpperCase()} 监控模块` });
      } else {
        content.classList.add('hidden');
        icon.classList.add('rotate-180');
        label.textContent = sec === 'logs' ? '展开表格' : '展开面板';
        showToast({ type: 'info', title: '面板折叠', message: `已收起 ${sec.toUpperCase()} 监控模块` });
      }
    }

    function capitalize(str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function switchLayoutPreset(preset) {
      const btnAll = document.getElementById('btnViewAll');
      const btnCharts = document.getElementById('btnViewCharts');
      const btnLogs = document.getElementById('btnViewLogs');

      [btnAll, btnCharts, btnLogs].forEach(b => {
        b.className = "px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition interactive-btn";
      });

      if (preset === 'all') {
        btnAll.className = "px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm transition interactive-btn";
        setSectionVisibility('kpis', true);
        setSectionVisibility('charts', true);
        setSectionVisibility('logs', true);
        showToast({ type: 'info', title: '布局模式', message: '已切换至全景概览模式' });
      } else if (preset === 'charts') {
        btnCharts.className = "px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm transition interactive-btn";
        setSectionVisibility('kpis', true);
        setSectionVisibility('charts', true);
        setSectionVisibility('logs', false);
        showToast({ type: 'info', title: '布局模式', message: '已切换至图表分析矩阵专注模式' });
      } else if (preset === 'logs') {
        btnLogs.className = "px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm transition interactive-btn";
        setSectionVisibility('kpis', false);
        setSectionVisibility('charts', false);
        setSectionVisibility('logs', true);
        showToast({ type: 'info', title: '布局模式', message: '已切换至日志排查专注模式' });
      }
    }

    function setSectionVisibility(sec, visible) {
      sectionStates[sec] = visible;
      const content = document.getElementById(`content${capitalize(sec)}`);
      const icon = document.getElementById(`iconToggle${capitalize(sec)}`);
      const label = document.getElementById(`labelToggle${capitalize(sec)}`);
      if (visible) {
        content.classList.remove('hidden');
        icon.classList.remove('rotate-180');
        label.textContent = sec === 'logs' ? '收起表格' : '收起面板';
      } else {
        content.classList.add('hidden');
        icon.classList.add('rotate-180');
        label.textContent = sec === 'logs' ? '展开表格' : '展开面板';
      }
    }

    // 2. Chart.js 实例初始化 (柱状图、圆形环形图与实时波形面积图)
    let waveformChartInstance = null;
    let endpointsChartInstance = null;
    let sourcesDonutChartInstance = null;
    let statusDonutChartInstance = null;

    // 波形滑动时间轴数据缓存 (20 个点)
    const waveTimelineLabels = Array.from({ length: 20 }, (_, i) => `${(20 - i) * 3}s前`);
    const waveLatencyData = Array.from({ length: 20 }, () => 20 + Math.floor(Math.random() * 15));
    const waveRpsData = Array.from({ length: 20 }, () => 5 + Math.floor(Math.random() * 8));

    function initCharts() {
      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#94a3b8' : '#64748b';
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';

      // 1. 实时波形面积图 (Waveform Spline Area Chart)
      const ctxWave = document.getElementById('waveformChart').getContext('2d');
      const waveGrad = ctxWave.createLinearGradient(0, 0, 0, 240);
      waveGrad.addColorStop(0, 'rgba(14, 165, 233, 0.35)');
      waveGrad.addColorStop(1, 'rgba(14, 165, 233, 0.00)');

      waveformChartInstance = new Chart(ctxWave, {
        type: 'line',
        data: {
          labels: waveTimelineLabels,
          datasets: [
            {
              label: '时延 Latency (ms)',
              data: waveLatencyData,
              borderColor: '#0ea5e9',
              borderWidth: 2.5,
              backgroundColor: waveGrad,
              fill: true,
              tension: 0.42,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: '#0ea5e9',
              yAxisID: 'yLatency',
            },
            {
              label: '吞吐 RPS',
              data: waveRpsData,
              borderColor: '#6366f1',
              borderWidth: 2,
              backgroundColor: 'transparent',
              borderDash: [4, 4],
              tension: 0.42,
              pointRadius: 0,
              pointHoverRadius: 4,
              yAxisID: 'yRps',
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 600, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? '#0f172a' : '#ffffff',
              titleColor: isDark ? '#ffffff' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 10,
            }
          },
          scales: {
            x: {
              ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 }, maxTicksLimit: 7 },
              grid: { display: false }
            },
            yLatency: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 } },
              grid: { color: gridColor }
            },
            yRps: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              ticks: { color: '#6366f1', font: { family: 'JetBrains Mono', size: 11 }, precision: 0 },
              grid: { display: false }
            }
          }
        }
      });

      // 2. 接口请求柱状图 (Endpoints Bar Chart)
      const ctxEp = document.getElementById('endpointsChart').getContext('2d');
      endpointsChartInstance = new Chart(ctxEp, {
        type: 'bar',
        data: {
          labels: ['/match', '/ncmget', '/search', '/playlist', '/lyric', '/info'],
          datasets: [{
            label: '请求频次',
            data: [0, 0, 0, 0, 0, 0],
            backgroundColor: [
              'rgba(14, 165, 233, 0.85)',
              'rgba(99, 102, 241, 0.85)',
              'rgba(168, 85, 247, 0.85)',
              'rgba(236, 72, 153, 0.85)',
              'rgba(16, 185, 129, 0.85)',
              'rgba(245, 158, 11, 0.85)'
            ],
            borderRadius: 8,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? '#0f172a' : '#ffffff',
              titleColor: isDark ? '#ffffff' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 10,
            }
          },
          scales: {
            x: {
              ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 } },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 11 }, precision: 0 },
              grid: { color: gridColor }
            }
          }
        }
      });

      // 3. 音源命中圆形环形图 (Sources Donut Chart)
      const ctxSrc = document.getElementById('sourcesDonutChart').getContext('2d');
      sourcesDonutChartInstance = new Chart(ctxSrc, {
        type: 'doughnut',
        data: {
          labels: ['BODIAN', 'GDSTUDIO', 'JOOX', 'KUGOU', 'KUWO', 'BILI'],
          datasets: [{
            data: [45, 25, 15, 8, 5, 2],
            backgroundColor: [
              '#10b981',
              '#0ea5e9',
              '#6366f1',
              '#f59e0b',
              '#ec4899',
              '#8b5cf6'
            ],
            borderWidth: isDark ? 2 : 1,
            borderColor: isDark ? '#0f172a' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: textColor, font: { size: 11, family: 'JetBrains Mono' }, boxWidth: 10 }
            },
            tooltip: {
              backgroundColor: isDark ? '#0f172a' : '#ffffff',
              titleColor: isDark ? '#ffffff' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 10,
            }
          }
        }
      });

      // 4. HTTP 状态码分布圆形环形图 (Status Donut Chart)
      const ctxStatus = document.getElementById('statusDonutChart').getContext('2d');
      statusDonutChartInstance = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
          labels: ['200 成功', '400 校验', '401 未授权', '429 限流', '404 缺失', '500 异常'],
          datasets: [{
            data: [98, 1, 0, 0, 1, 0],
            backgroundColor: [
              '#10b981',
              '#f59e0b',
              '#6366f1',
              '#ec4899',
              '#94a3b8',
              '#f43f5e'
            ],
            borderWidth: isDark ? 2 : 1,
            borderColor: isDark ? '#0f172a' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: textColor, font: { size: 11, family: 'Plus Jakarta Sans' }, boxWidth: 10 }
            },
            tooltip: {
              backgroundColor: isDark ? '#0f172a' : '#ffffff',
              titleColor: isDark ? '#ffffff' : '#0f172a',
              bodyColor: isDark ? '#cbd5e1' : '#334155',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 10,
            }
          }
        }
      });
    }

    // 3. 昼夜模式
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    function setTheme(isDark, silent = false) {
      if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        if (!silent) showToast({ type: 'info', title: '主题模式', message: '已切换至深色暗夜模式 🌙' });
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        if (!silent) showToast({ type: 'info', title: '主题模式', message: '已切换至清爽浅色模式 ☀️' });
      }
      lucide.createIcons();
    }

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && prefersDark.matches)) {
      setTheme(true, true);
    } else {
      setTheme(false, true);
    }

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(!isDark);
      if (waveformChartInstance && endpointsChartInstance && sourcesDonutChartInstance && statusDonutChartInstance) {
        waveformChartInstance.destroy();
        endpointsChartInstance.destroy();
        sourcesDonutChartInstance.destroy();
        statusDonutChartInstance.destroy();
        initCharts();
        loadDashboardData(currentPage, false);
      }
    });

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

    // 点击灵动岛外部自动优雅收起
    document.addEventListener('click', (e) => {
      const island = document.getElementById('dynamicIsland');
      if (isIslandExpanded && island && !island.contains(e.target)) {
        window.collapseDynamicIsland();
      }
    });
    let pollTimer = null;
    let pollInterval = 3000;
    let currentPage = 1;
    const pageLimit = 25;
    let currentLogsCache = [];

    function changePollInterval(val) {
      pollInterval = parseInt(val, 10);
      clearInterval(pollTimer);
      const dot = document.getElementById('refreshPulseDot');
      if (pollInterval > 0) {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
        pollTimer = setInterval(() => loadDashboardData(currentPage, false), pollInterval);
        showToast({ type: 'info', title: '轮询配置', message: `自动刷新间隔已设置为 ${pollInterval / 1000} 秒` });
      } else {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
        showToast({ type: 'warning', title: '轮询已暂停', message: '已暂停后台自动数据刷新' });
      }
    }

    let searchDebounce = null;
    function debounceSearch() {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const kw = document.getElementById('inputSearchKeyword').value.trim();
        loadDashboardData(1);
        if (kw) {
          showToast({ type: 'info', title: '筛选检索', message: `正在检索关键词: "${kw}"` });
        }
      }, 350);
    }

    function onFilterChange() {
      const ep = document.getElementById('selectEndpointFilter').value;
      const st = document.getElementById('selectStatusFilter').value;
      loadDashboardData(1);
      showToast({ type: 'info', title: '过滤条件已更新', message: `端点: ${ep || '全部'} · 状态: ${st || '全部'}` });
    }

    // 5. 拉取监控数据 (带自动 API Key 鉴权头)
    async function loadDashboardData(page = 1, showSpinner = true) {
      currentPage = page;
      const pathFilter = document.getElementById('selectEndpointFilter').value;
      const statusFilter = document.getElementById('selectStatusFilter').value;
      const keyword = document.getElementById('inputSearchKeyword').value;

      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageLimit),
        path: pathFilter,
        status: statusFilter,
        keyword,
      });

      try {
        const res = await fetch(`/api/monitor/data?${query.toString()}`, {
          headers: getAuthHeaders(),
        });

        if (res.status === 401) {
          showToast({ type: 'warning', title: '需要鉴权', message: '监控接口需要访问密钥凭证 (API Key)' });
          openApiKeyModal();
          return;
        }

        const json = await res.json();
        if (json.code === 200 && json.data) {
          renderStatsCards(json.data.stats);
          renderTelemetryLogs(json.data.logs, json.data.totalLogs);
          currentLogsCache = json.data.logs;
        }
      } catch (err) {
        console.warn('Load telemetry error:', err);
      }
    }

    // 6. 渲染统计卡片与图表
    function renderStatsCards(stats) {
      document.getElementById('statTotalRequests').textContent = stats.totalRequests || 0;
      const successRate = stats.totalRequests > 0
        ? ((stats.successRequests / stats.totalRequests) * 100).toFixed(1)
        : 100;
      document.getElementById('statSuccessPct').innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 inline"></i> <span>${successRate}% 成功率</span>`;
      document.getElementById('statFailedBadge').textContent = `${stats.failedRequests || 0} 异常`;
      document.getElementById('statAvgLatency').textContent = `${stats.avgDuration || 0} ms`;
      document.getElementById('statCallerCount').textContent = stats.topCallers?.length || 0;

      const upSec = stats.uptime || 0;
      const h = Math.floor(upSec / 3600);
      const m = Math.floor((upSec % 3600) / 60);
      const s = upSec % 60;
      document.getElementById('statDashboardUptime').textContent = `${h}h ${m}m ${s}s`;

      const total = stats.totalRequests || 1;

      // 实时推进更新波形折线图
      if (waveformChartInstance) {
        waveLatencyData.shift();
        waveLatencyData.push(stats.avgDuration || 20);
        waveRpsData.shift();
        waveRpsData.push(Math.max(1, Math.floor(total / Math.max(1, upSec || 1)) + Math.floor(Math.random() * 4)));
        waveformChartInstance.update('none');
      }

      // 更新 Chart.js 接口柱状图数据
      if (endpointsChartInstance && stats.topEndpoints) {
        const labels = stats.topEndpoints.map(e => e.name);
        const data = stats.topEndpoints.map(e => e.count);
        endpointsChartInstance.data.labels = labels.length ? labels : ['/match', '/ncmget', '/search', '/info'];
        endpointsChartInstance.data.datasets[0].data = data.length ? data : [0, 0, 0, 0];
        endpointsChartInstance.update();
      }

      // 更新 Chart.js 音源圆形环形图数据 (Sources Donut)
      if (sourcesDonutChartInstance && stats.topSources) {
        const labels = stats.topSources.map(s => s.name.toUpperCase());
        const data = stats.topSources.map(s => s.count);
        if (labels.length > 0) {
          sourcesDonutChartInstance.data.labels = labels;
          sourcesDonutChartInstance.data.datasets[0].data = data;
          sourcesDonutChartInstance.update();
        }
      }

      // 更新状态码圆形环形图数据 (Status Donut)
      if (statusDonutChartInstance && stats.statusCodes) {
        const c200 = stats.statusCodes['200'] || 0;
        const c400 = stats.statusCodes['400'] || 0;
        const c401 = stats.statusCodes['401'] || 0;
        const c429 = stats.statusCodes['429'] || 0;
        const c404 = stats.statusCodes['404'] || 0;
        const c500 = stats.statusCodes['500'] || 0;
        statusDonutChartInstance.data.datasets[0].data = [c200, c400, c401, c429, c404, c500];
        statusDonutChartInstance.update();
      }

      // 渲染 Top Callers (Who)
      const callerContainer = document.getElementById('topCallersList');
      if (stats.topCallers && stats.topCallers.length > 0) {
        callerContainer.innerHTML = stats.topCallers.map(item => {
          const pct = Math.min(Math.round((item.count / total) * 100), 100);
          return `
            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200/60 dark:border-white/5 space-y-2 interactive-btn">
              <div class="flex items-center justify-between">
                <span class="truncate max-w-[200px] font-bold text-slate-800 dark:text-slate-200" title="${item.name}">${item.name}</span>
                <span class="font-bold font-mono px-2.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 text-xs">${item.count} 次 (${pct}%)</span>
              </div>
              <div class="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div class="h-full bg-indigo-500 rounded-full" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        callerContainer.innerHTML = '<div class="text-slate-400 text-center py-6 col-span-full">暂无调用源数据</div>';
      }
    }

    // 7. 渲染表格明细
    function renderTelemetryLogs(logs, total) {
      document.getElementById('labelTotalCount').textContent = total || 0;
      document.getElementById('labelCurrentPage').textContent = currentPage;

      const tbody = document.getElementById('logsTableContent');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-slate-400 font-medium">未检索到匹配的请求调用记录</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map(l => {
        let codeBadge = `<span class="px-2.5 py-1 rounded-md font-mono font-bold text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">${l.status}</span>`;
        if (l.status >= 400 && l.status < 500) {
          codeBadge = `<span class="px-2.5 py-1 rounded-md font-mono font-bold text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">${l.status}</span>`;
        } else if (l.status >= 500) {
          codeBadge = `<span class="px-2.5 py-1 rounded-md font-mono font-bold text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">${l.status}</span>`;
        }

        const callerDisplay = l.referer !== '-'
          ? `<span class="truncate block max-w-[180px] font-medium text-slate-800 dark:text-slate-200" title="${l.referer}">${l.referer}</span>`
          : `<span class="text-slate-400 font-medium">Direct API</span>`;

        return `
          <tr class="hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition cursor-pointer" onclick="openDrawer('${l.id}')">
            <td class="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap text-xs sm:text-sm">${l.timeStr}</td>
            <td class="py-3.5 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200 text-xs sm:text-sm">
              <span class="text-sky-500 font-bold">${l.method}</span> ${l.path}
            </td>
            <td class="py-3.5 px-4">${codeBadge}</td>
            <td class="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 font-semibold text-xs sm:text-sm">${l.duration}ms</td>
            <td class="py-3.5 px-4">${callerDisplay}</td>
            <td class="py-3.5 px-4">
              <span class="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold">${l.clientType}</span>
            </td>
            <td class="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400 text-xs sm:text-sm">${l.ip}</td>
            <td class="py-3.5 px-4 text-right">
              <button onclick="event.stopPropagation(); openDrawer('${l.id}')" class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-500 hover:text-white transition text-xs font-bold interactive-btn">查看</button>
            </td>
          </tr>
        `;
      }).join('');

      document.getElementById('btnPrevPage').disabled = currentPage <= 1;
      document.getElementById('btnNextPage').disabled = (currentPage * pageLimit) >= total;
      lucide.createIcons();
    }

    function paginate(delta) {
      const target = currentPage + delta;
      if (target >= 1) {
        loadDashboardData(target);
        showToast({ type: 'info', title: '分页切换', message: `正在加载第 ${target} 页数据...` });
      }
    }

    // 8. 侧边抽屉明细
    function openDrawer(id) {
      const item = currentLogsCache.find(l => l.id === id);
      if (!item) return;

      document.getElementById('drawerLogId').textContent = item.id;
      document.getElementById('drawerIp').textContent = item.ip;
      document.getElementById('drawerDuration').textContent = `${item.duration} ms`;
      document.getElementById('drawerFullUrl').textContent = item.fullUrl;
      document.getElementById('drawerReferer').textContent = item.referer;
      document.getElementById('drawerUserAgent').textContent = item.userAgent;
      document.getElementById('drawerQueryJson').textContent = JSON.stringify(item.query, null, 2);

      document.getElementById('drawerOverlay').classList.remove('hidden');
      lucide.createIcons();
      showToast({ type: 'info', title: '明细展开', message: `已载入请求 ${item.path} 遥测结构` });
    }

    function closeDrawer() {
      document.getElementById('drawerOverlay').classList.add('hidden');
    }

    // 9. 现代确认对话框
    let confirmCallback = null;
    function showConfirmDialog({ title = '确认操作', message = '', onConfirm = null }) {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      confirmCallback = onConfirm;
      document.getElementById('confirmModal').classList.remove('hidden');
      lucide.createIcons();
    }

    function closeConfirm(accepted) {
      document.getElementById('confirmModal').classList.add('hidden');
      if (accepted && typeof confirmCallback === 'function') {
        confirmCallback();
      }
      confirmCallback = null;
    }

    // 10. 清空与导出
    async function clearLogsData() {
      showConfirmDialog({
        title: '清空遥测日志',
        message: '确定要重置并清空所有内存遥测日志记录吗？清空后当前聚合统计与明细将全部重置。',
        onConfirm: async () => {
          try {
            const res = await fetch('/api/monitor/clear', {
              method: 'POST',
              headers: getAuthHeaders(),
            });
            if (res.status === 401) {
              showToast({ type: 'error', title: '未授权', message: '清空日志需要正确的 API Key' });
              openApiKeyModal();
              return;
            }
            loadDashboardData(1);
            showToast({ type: 'success', title: '清空完成', message: '已成功重置所有遥测数据与内存日志' });
          } catch (err) {
            showToast({ type: 'error', title: '清空失败', message: err.message });
          }
        }
      });
    }

    function exportJsonLogs() {
      if (!currentLogsCache || currentLogsCache.length === 0) {
        showToast({ type: 'warning', title: '暂无数据', message: '当前没有可导出的调用记录' });
        return;
      }
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentLogsCache, null, 2));
      const anchor = document.createElement('a');
      anchor.setAttribute('href', dataStr);
      anchor.setAttribute('download', `telemetry-logs-${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast({ type: 'success', title: '导出成功', message: `已成功导出 ${currentLogsCache.length} 条遥测记录为 JSON` });
    }

    // 初始启动
    document.querySelectorAll('.current-year-text').forEach(el => el.textContent = String(new Date().getFullYear()));
    fetch('/info').then(r => r.json()).then(j => {
      if (j?.data?.version) {
        document.querySelectorAll('.app-version-badge').forEach(el => el.textContent = `v${j.data.version} PRO`);
      }
    }).catch(() => {});
    initCharts();
    loadDashboardData(1);
    changePollInterval(3000);
    lucide.createIcons();
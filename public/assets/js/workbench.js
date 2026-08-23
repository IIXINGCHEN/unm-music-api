/**
 * UNM-Server 调试台模块：API 端点切换、URL/cURL 预览复制、JSON 语法高亮、实时请求与一键极速测试。
 * 依赖：core.js（showToast）、player.js（playSongItem）。
 */

// --- 调试台域共享状态 ---
let currentSearchTab = 'match';
let lastTestedAudioUrl = '';
let lastRawResponseJson = '';

    // --- 方案 A: 在线 API 调试台 ---
    function buildWorkbenchUrl() {
      const val = (document.getElementById('testInput')?.value || '').trim();
      const server = document.getElementById('serverSelect')?.value || '';
      const br = document.getElementById('bitrateSelect')?.value || '320';

      let url = '';
      if (currentSearchTab === 'match') url = `/match?id=${encodeURIComponent(val || '191060')}&br=${br}${server ? '&server=' + server : ''}`;
      else if (currentSearchTab === 'ncmget') url = `/ncmget?id=${encodeURIComponent(val || '186016')}&br=${br}`;
      else if (currentSearchTab === 'search') url = `/search?name=${encodeURIComponent(val || '天赐的声音')}&count=10${server ? '&source=' + server : ''}`;
      else if (currentSearchTab === 'lyric') url = `/lyric?id=${encodeURIComponent(val || '191060')}${server ? '&source=' + server : ''}`;
      else if (currentSearchTab === 'pic') url = `/pic?id=${encodeURIComponent(val || '191060')}&size=500${server ? '&source=' + server : ''}`;
      else if (currentSearchTab === 'playlist') url = `/playlist/${encodeURIComponent(val || '8401628431')}?limit=1000`;
      else if (currentSearchTab === 'health') url = '/health?verbose=true';
      else if (currentSearchTab === 'info') url = '/info';
      return url;
    }

    function updateWorkbenchUrlPreview() {
      const el = document.getElementById('previewRequestUrl');
      if (el) el.textContent = buildWorkbenchUrl();
    }

    function openWorkbenchUrlInNewTab() {
      window.open(buildWorkbenchUrl(), '_blank');
    }

    function copyResponseJson() {
      const out = document.getElementById('jsonOutput');
      if (!out) return;
      const text = lastRawResponseJson || out.textContent || '';
      navigator.clipboard.writeText(text).then(() =>
        showToast({ type: 'success', title: 'JSON 已复制', message: '响应数据已复制到剪贴板' })
      );
    }

    function copyWorkbenchCurl() {
      const curlCmd = `curl -X GET "${window.location.origin}${buildWorkbenchUrl()}"`;
      navigator.clipboard.writeText(curlCmd).then(() =>
        showToast({ type: 'success', title: 'cURL 已复制', message: curlCmd })
      );
    }

    function syntaxHighlightJson(json) {
      if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
      json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
        else if (/true|false/.test(match)) cls = 'json-boolean';
        else if (/null/.test(match)) cls = 'json-null';
        return '<span class="' + cls + '">' + match + '</span>';
      });
    }

    function switchApiTab(tab) {
      currentSearchTab = tab;
      document.querySelectorAll('#apiTabs button').forEach(btn => {
        if (btn.getAttribute('data-tab') === tab) btn.className = 'px-3 py-1.5 rounded-xl tab-active transition interactive-btn whitespace-nowrap';
        else btn.className = 'px-3 py-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-sky-500 transition interactive-btn whitespace-nowrap';
      });

      const label = document.getElementById('inputLabel');
      const input = document.getElementById('testInput');
      const brContainer = document.getElementById('bitrateContainer');
      const serverSelectWrapper = document.getElementById('serverSelectWrapper');

      [brContainer, serverSelectWrapper].forEach(el => el.classList.remove('hidden'));

      if (tab === 'match') {
        label.textContent = '网易云歌曲 ID (例如: 191060)';
        input.value = '191060';
      } else if (tab === 'ncmget') {
        label.textContent = '网易云官方直链歌曲 ID (例如: 186016)';
        input.value = '186016';
        serverSelectWrapper.classList.add('hidden');
      } else if (tab === 'search') {
        label.textContent = '搜索关键词 (例如: 天赐的声音)';
        input.value = '天赐的声音';
        brContainer.classList.add('hidden');
      } else if (tab === 'lyric') {
        label.textContent = '歌曲 ID (例如: 191060)';
        input.value = '191060';
        brContainer.classList.add('hidden');
      } else if (tab === 'pic') {
        label.textContent = '歌曲或专辑封面 ID';
        input.value = '191060';
        brContainer.classList.add('hidden');
      } else if (tab === 'playlist') {
        label.textContent = '网易云歌单 ID (例如: 8401628431 - 天赐的声音)';
        input.value = '8401628431';
        brContainer.classList.add('hidden');
        serverSelectWrapper.classList.add('hidden');
      } else if (tab === 'health') {
        label.textContent = '详细诊断参数 (true/false)';
        input.value = 'true';
        brContainer.classList.add('hidden');
        serverSelectWrapper.classList.add('hidden');
      } else if (tab === 'info') {
        label.textContent = '无额外参数';
        input.value = '-';
        brContainer.classList.add('hidden');
        serverSelectWrapper.classList.add('hidden');
      }
      updateWorkbenchUrlPreview();
    }

    function fillPreset(id, tab, name) {
      switchApiTab(tab);
      document.getElementById('testInput').value = id;
      updateWorkbenchUrlPreview();
      executeApiTest();
      showToast({ type: 'info', title: '已载入预设', message: name });
    }

    function testInWorkbench(id, name) {
      document.getElementById('workbench').scrollIntoView({ behavior: 'smooth' });
      switchApiTab('match');
      document.getElementById('testInput').value = id;
      updateWorkbenchUrlPreview();
      executeApiTest();
    }

    async function executeApiTest() {
      const url = buildWorkbenchUrl();
      const btn = document.getElementById('executeBtn');
      const out = document.getElementById('jsonOutput');

      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>请求中...</span>';
      lucide.createIcons();

      const startTime = performance.now();
      try {
        const res = await fetch(url);
        const duration = Math.round(performance.now() - startTime);
        const json = await res.json();
        lastRawResponseJson = JSON.stringify(json, null, 2);

        document.getElementById('resStatus').textContent = `HTTP ${res.status}`;
        document.getElementById('resLatency').textContent = `耗时: ${duration}ms`;
        document.getElementById('resSource').textContent = `命中音源: ${json.data?.source || '-'}`;
        out.innerHTML = syntaxHighlightJson(json);

        if (json.data?.url) lastTestedAudioUrl = json.data.url;
        showToast({ type: 'success', title: 'API 请求完成', message: `耗时 ${duration}ms` });
      } catch (err) {
        document.getElementById('resStatus').textContent = 'HTTP 500 ERROR';
        out.innerHTML = `<span class="text-rose-400">请求异常: ${err.message}</span>`;
        showToast({ type: 'error', title: '请求失败', message: err.message });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i><span>发送实时请求</span>';
        lucide.createIcons();
      }
    }

    async function executeQuickTest() {
      showToast({ type: 'info', title: '一键极速测试', message: '正在请求 /test 端点...' });
      try {
        const res = await fetch('/test');
        const json = await res.json();
        if (json.code === 200 && json.data?.url) {
          showToast({ type: 'success', title: '测试匹配成功', message: `命中音源: ${json.data.source}` });
          playSongItem({ id: '186016', name: '晴天', artist: '周杰伦', source: json.data.source, url: json.data.url });
        } else {
          throw new Error(json.message || '未返回有效音频');
        }
      } catch (e) {
        showToast({ type: 'error', title: '测试请求失败', message: e.message });
      }
    }

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

    updateWorkbenchUrlPreview();

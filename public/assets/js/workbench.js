/**
 * UNM-Server 调试台模块：API 端点切换、URL/cURL 预览复制、JSON 语法高亮、实时请求与一键试听/播放歌曲。
 * 依赖：core.js（showToast）、player.js（playSongItem/playQueue/renderPlayerQueue/showPlayerBar）。
 */

// --- 调试台域共享状态 ---
let currentSearchTab = 'match';
let lastTestedAudioUrl = '';
let lastTestedAudio = null;
let lastTestedPlaylistTracks = null;
let lastRawResponseJson = '';

    // 智能提取输入框中的 ID 或参数（支持纯数字、完整 URL、分享链接）
    function extractIdFromInput(input) {
      if (!input) return '';
      const str = input.trim();
      const mQuery = str.match(/[?&]id=(\d+)/i);
      if (mQuery) return mQuery[1];
      const mPath = str.match(/\/(?:playlist|song|album)\/(\d+)/i);
      if (mPath) return mPath[1];
      const mDigits = str.match(/^(\d+)$/);
      if (mDigits) return mDigits[1];
      return str;
    }

    // --- 在线 API 调试台 URL 构造 ---
    function buildWorkbenchUrl() {
      const rawVal = (document.getElementById('testInput')?.value || '').trim();
      const val = (currentSearchTab === 'match' || currentSearchTab === 'ncmget' || currentSearchTab === 'playlist' || currentSearchTab === 'lyric' || currentSearchTab === 'pic')
        ? extractIdFromInput(rawVal)
        : rawVal;
      const server = document.getElementById('serverSelect')?.value || '';
      const br = document.getElementById('bitrateSelect')?.value || '320';

      let url = '';
      if (currentSearchTab === 'match') url = `/match?id=${encodeURIComponent(val || '191060')}&br=${br}${server ? '&server=' + server : ''}`;
      else if (currentSearchTab === 'ncmget') url = `/ncmget?id=${encodeURIComponent(val || '186016')}&br=${br}`;
      else if (currentSearchTab === 'otherget') url = `/otherget?name=${encodeURIComponent(val || '晴天')}`;
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
      const playBtn = document.getElementById('playWorkbenchBtn');

      [brContainer, serverSelectWrapper].forEach(el => el.classList.remove('hidden'));
      if (playBtn) playBtn.classList.remove('hidden');

      if (tab === 'match') {
        label.textContent = '网易云歌曲 ID (例如: 191060 - 张杰《这，就是爱》)';
        input.value = '191060';
      } else if (tab === 'ncmget') {
        label.textContent = '网易云官方直链歌曲 ID (例如: 186016 - 周杰伦《晴天》)';
        input.value = '186016';
        serverSelectWrapper.classList.add('hidden');
      } else if (tab === 'otherget') {
        label.textContent = '歌曲名称 (例如: 晴天 / 孤勇者 / 泡沫)';
        input.value = '晴天';
        brContainer.classList.add('hidden');
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
        label.textContent = '歌曲或专辑封面 ID (例如: 191060)';
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
        if (playBtn) playBtn.classList.add('hidden');
      } else if (tab === 'info') {
        label.textContent = '无额外参数';
        input.value = '-';
        brContainer.classList.add('hidden');
        serverSelectWrapper.classList.add('hidden');
        if (playBtn) playBtn.classList.add('hidden');
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

    // --- 核心播放动作：解析并播放输入框当前对应的歌曲或歌单 ---
    async function playCurrentWorkbenchTrack() {
      const rawVal = (document.getElementById('testInput')?.value || '').trim();
      const val = extractIdFromInput(rawVal);
      const server = document.getElementById('serverSelect')?.value || '';
      const playBtn = document.getElementById('playWorkbenchBtn');

      if (!val || val === '-') {
        showToast({ type: 'warning', title: '请输入有效参数', message: '请在输入框填入歌曲 ID、歌名、歌单 ID 或完整链接' });
        return;
      }

      // 若上次请求返回的正是当前 ID 的解析结果且含有直链，直接快速播放
      if (lastTestedAudio && (lastTestedAudio.id === val || lastTestedAudio.id === rawVal) && lastTestedAudio.url) {
        playSongItem(lastTestedAudio);
        return;
      }

      if (playBtn) {
        playBtn.disabled = true;
        playBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>调度中...</span>';
        lucide.createIcons();
      }

      try {
        if (currentSearchTab === 'otherget') {
          showToast({ type: 'info', title: '正在检索跨源音源', message: `正在为《${rawVal}》调度直链...` });
          const res = await fetch(`/otherget?name=${encodeURIComponent(rawVal)}`);
          const json = await res.json();
          if (json.code === 200 && json.data?.url) {
            const track = {
              id: 'other-' + Date.now(),
              name: rawVal,
              artist: `跨源音源 (${json.data.source || 'other'})`,
              album: 'UNM 调试台',
              url: json.data.url,
              source: json.data.source,
            };
            lastTestedAudio = track;
            lastTestedAudioUrl = json.data.url;
            playSongItem(track);
          } else {
            throw new Error(json.message || '未找到可播放音频');
          }
        } else if (currentSearchTab === 'search') {
          showToast({ type: 'info', title: '正在搜索曲目', message: `关键词: ${rawVal}` });
          const res = await fetch(`/search?name=${encodeURIComponent(rawVal)}&count=5${server ? '&source=' + server : ''}`);
          const json = await res.json();
          if (json.code === 200 && Array.isArray(json.data) && json.data.length > 0) {
            const first = json.data[0];
            const track = {
              id: first.id || first.song_id || first.mid,
              urlId: first.url_id || '',
              lyricId: first.lyric_id || '',
              name: first.name || first.title || rawVal,
              artist: Array.isArray(first.artist) ? first.artist.join('/') : (first.artist || first.singer || '未知歌手'),
              album: first.album || first.album_name || '搜索结果',
              pic: first.pic || first.cover || first.picUrl || '',
              source: first.source || server || 'netease',
            };
            playSongItem(track);
          } else {
            throw new Error(json.message || '未搜索到相关曲目');
          }
        } else if (currentSearchTab === 'playlist') {
          showToast({ type: 'info', title: '正在解析歌单', message: `歌单 ID: ${val}` });
          const res = await fetch(`/playlist/${encodeURIComponent(val)}?limit=100`);
          const json = await res.json();
          if (json.code === 200 && Array.isArray(json.data?.tracks) && json.data.tracks.length > 0) {
            const tracks = json.data.tracks.map((t) => ({
              id: t.id,
              name: t.name || t.title,
              artist: t.artist || t.ar?.[0]?.name || '未知歌手',
              album: t.album || t.al?.name || '歌单收录',
              pic: t.pic || t.al?.picUrl || '',
              source: 'netease',
            }));
            playQueue = tracks;
            currentQueueIndex = 0;
            lastTestedPlaylistTracks = tracks;
            renderPlayerQueue();
            playSongItem(tracks[0]);
            showToast({ type: 'success', title: '歌单载入成功', message: `已载入《${json.data.name || '歌单'}》共 ${tracks.length} 首歌曲并开始播放第一首` });
          } else {
            throw new Error(json.message || '歌单为空或解析失败');
          }
        } else {
          // match / ncmget / lyric / pic 默认按歌曲 ID 播放
          const track = {
            id: val,
            name: `歌曲 ID: ${val}`,
            artist: 'UNM 调试曲目',
            album: '在线 API 调试台',
            source: server || 'netease',
          };
          playSongItem(track);
        }
      } catch (err) {
        showToast({ type: 'error', title: '试听播放失败', message: err.message || '未能成功获取直链' });
      } finally {
        if (playBtn) {
          playBtn.disabled = false;
          playBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5"></i><span>试听播放</span>';
          lucide.createIcons();
        }
      }
    }

    // --- 播放上次测试响应出的音频或歌单 ---
    function playLastTestedAudio() {
      if (lastTestedPlaylistTracks && lastTestedPlaylistTracks.length > 0) {
        playQueue = lastTestedPlaylistTracks;
        currentQueueIndex = 0;
        renderPlayerQueue();
        playSongItem(lastTestedPlaylistTracks[0]);
        showToast({ type: 'success', title: '开始播放歌单', message: `已载入 ${lastTestedPlaylistTracks.length} 首歌曲` });
        return;
      }
      if (lastTestedAudio) {
        playSongItem(lastTestedAudio);
      } else if (lastTestedAudioUrl) {
        const val = extractIdFromInput(document.getElementById('testInput')?.value || '');
        playSongItem({
          id: val || 'tested',
          name: `测试曲目 (${val || '直链'})`,
          artist: 'UNM 调试台',
          url: lastTestedAudioUrl,
        });
      } else {
        showToast({ type: 'warning', title: '暂无可用音频', message: '请先发送请求或点击“试听播放”解析音频' });
      }
    }

    async function executeApiTest() {
      const url = buildWorkbenchUrl();
      const btn = document.getElementById('executeBtn');
      const out = document.getElementById('jsonOutput');
      const resPlayBtn = document.getElementById('resPlayBtn');

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

        // 重置暂存状态
        lastTestedAudio = null;
        lastTestedPlaylistTracks = null;

        if (json.data?.tracks && Array.isArray(json.data.tracks) && json.data.tracks.length > 0) {
          // 歌单响应：提取曲目列表并支持一键播放
          lastTestedPlaylistTracks = json.data.tracks.map((t) => ({
            id: t.id,
            name: t.name || t.title,
            artist: t.artist || t.ar?.[0]?.name || '未知歌手',
            album: t.album || t.al?.name || (json.data.name || '歌单收录'),
            pic: t.pic || t.al?.picUrl || json.data.coverImgUrl || '',
            source: 'netease',
          }));
          if (resPlayBtn) {
            resPlayBtn.innerHTML = `<i data-lucide="list-music" class="w-3.5 h-3.5"></i><span>播放歌单 (${lastTestedPlaylistTracks.length}首)</span>`;
            resPlayBtn.classList.remove('hidden');
            lucide.createIcons();
          }
        } else if (json.data?.url) {
          // 单曲响应：提取音频直链
          lastTestedAudioUrl = json.data.url;
          const rawVal = (document.getElementById('testInput')?.value || '').trim();
          const val = extractIdFromInput(rawVal);
          lastTestedAudio = {
            id: json.data.id || val,
            name: json.data.title || `歌曲 ${val}`,
            artist: json.data.artist || 'UNM 调试台',
            album: json.data.album || 'API 响应结果',
            pic: json.data.pic || '',
            source: json.data.source || 'netease',
            url: json.data.url,
            br: json.data.br,
          };
          if (resPlayBtn) {
            resPlayBtn.innerHTML = `<i data-lucide="play-circle" class="w-3.5 h-3.5"></i><span>播放解析音频</span>`;
            resPlayBtn.classList.remove('hidden');
            lucide.createIcons();
          }
        } else {
          if (resPlayBtn) resPlayBtn.classList.add('hidden');
        }

        showToast({ type: 'success', title: 'API 请求完成', message: `耗时 ${duration}ms` });
      } catch (err) {
        document.getElementById('resStatus').textContent = 'HTTP 500 ERROR';
        out.innerHTML = `<span class="text-rose-400">请求异常: ${err.message}</span>`;
        if (resPlayBtn) resPlayBtn.classList.add('hidden');
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

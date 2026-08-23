/**
 * UNM-Server 曲库模块：跨源搜索、歌单完整解析、过滤分页、曲目表格渲染与队列批量操作。
 * 依赖：core.js（showToast）、player.js（playQueue/playSongItem/renderPlayerQueue）。
 */

// --- 曲库域共享状态 ---
let currentMode = 'playlist';
let allFullTracks = [];
let filteredTracks = [];
let currentSearchResults = [];
let playlistFilterKeyword = '';
let currentPage = 1;
let totalPages = 1;
let pageSize = 20;

    // --- 搜索与歌单完整获取 + 多端分页管理 ---
    async function executeSearch(page = 1) {
      const keyword = document.getElementById('searchKeywordInput').value.trim();
      const source = document.getElementById('searchSourceSelect').value;
      if (!keyword) {
        showToast({ type: 'warning', title: '搜索提示', message: '请输入歌曲名或歌手' });
        return;
      }

      currentMode = 'search';
      const tbody = document.getElementById('trackListBody');
      tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-400"><i data-lucide="loader-2" class="w-8 h-8 mx-auto mb-2 animate-spin text-sky-500"></i><span>正在全网跨源搜索《${keyword}》...</span></td></tr>`;
      lucide.createIcons();

      try {
        const res = await fetch(`/search?name=${encodeURIComponent(keyword)}&source=${source}&count=50&page=${page}`);
        const json = await res.json();
        if (json.code === 200 && Array.isArray(json.data) && json.data.length > 0) {
          allFullTracks = json.data.map(item => ({
            id: item.id || item.song_id || item.mid,
            name: item.name || item.title || item.song_name,
            artist: Array.isArray(item.artist) ? item.artist.join('/') : (item.artist || item.singer),
            album: item.album || item.album_name || '-',
            source: item.source || source,
            picUrl: item.pic,
          }));
          document.getElementById('searchResultTitle').textContent = `搜索: 《${keyword}》`;
          playlistFilterKeyword = '';
          const filterInput = document.getElementById('playlistFilterInput');
          if (filterInput) filterInput.value = '';
          applyTrackListPagination(1);
        } else {
          tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-400">未检索到匹配的曲目</td></tr>`;
          lucide.createIcons();
        }
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-rose-400">搜索请求异常: ${err.message}</td></tr>`;
      }
    }

    async function loadPresetPlaylist(playlistId, title) {
      currentMode = 'playlist';
      showToast({ type: 'info', title: '正在载入歌单', message: `正在完整获取《${title}》全部曲目...` });
      const tbody = document.getElementById('trackListBody');
      tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-400"><i data-lucide="loader-2" class="w-8 h-8 mx-auto mb-2 animate-spin text-sky-500"></i><span>正在完整解析歌单《${title}》(ID: ${playlistId}) 全部曲目...</span></td></tr>`;
      lucide.createIcons();

      try {
        const res = await fetch(`/playlist/${playlistId}?limit=1000`);
        const json = await res.json();
        if (json.code === 200 && json.data) {
          const detail = json.data;
          let tracks = [];
          if (Array.isArray(detail.tracks) && detail.tracks.length > 0) {
            tracks = detail.tracks.map(t => ({
              id: t.id, name: t.name,
              artist: t.artist || '未知艺人',
              album: t.album || '-', source: 'netease', picUrl: t.picUrl
            }));
          } else if (Array.isArray(detail.songIds)) {
            tracks = detail.songIds.map((id, idx) => ({ id, name: `歌单曲目 #${idx + 1}`, artist: '网易云精选', album: title, source: 'netease' }));
          }
          allFullTracks = tracks;
          playlistFilterKeyword = '';
          const filterInput = document.getElementById('playlistFilterInput');
          if (filterInput) filterInput.value = '';
          document.getElementById('searchResultTitle').textContent = `歌单: ${detail.name || title}`;
          applyTrackListPagination(1);
          showToast({ type: 'success', title: '歌单全部曲目已就绪', message: `成功加载 ${tracks.length} 首歌曲，支持分页与筛选` });
        } else {
          throw new Error(json.message || '解析失败');
        }
      } catch (err) {
        showToast({ type: 'error', title: '歌单解析失败', message: err.message });
      }
    }

    function onPlaylistFilterInput(keyword) {
      playlistFilterKeyword = keyword.trim().toLowerCase();
      applyTrackListPagination(1);
    }

    function changePageSize(val) {
      pageSize = parseInt(val, 10) || 20;
      applyTrackListPagination(1);
    }

    function applyTrackListPagination(page = 1) {
      filteredTracks = playlistFilterKeyword
        ? allFullTracks.filter(t =>
            (t.name || '').toLowerCase().includes(playlistFilterKeyword) ||
            (t.artist || '').toLowerCase().includes(playlistFilterKeyword) ||
            (t.album || '').toLowerCase().includes(playlistFilterKeyword))
        : [...allFullTracks];

      const totalCount = filteredTracks.length;
      totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      currentPage = Math.min(Math.max(1, page), totalPages);

      const startIndex = (currentPage - 1) * pageSize;
      currentSearchResults = filteredTracks.slice(startIndex, startIndex + pageSize);

      renderTrackTable(currentSearchResults, startIndex);
      document.getElementById('searchResultCountBadge').textContent = `共 ${totalCount} 首`;
      document.getElementById('currentPageNum').textContent = currentPage;
      document.getElementById('totalPageNum').textContent = totalPages;
      document.getElementById('totalTracksNum').textContent = totalCount;

      const paginationContainer = document.getElementById('searchPagination');
      if (totalCount > 0) {
        paginationContainer.classList.remove('hidden');
        paginationContainer.classList.add('flex');
      } else {
        paginationContainer.classList.add('hidden');
      }

      document.getElementById('btnPageFirst').disabled = (currentPage === 1);
      document.getElementById('btnPagePrev').disabled = (currentPage === 1);
      document.getElementById('btnPageNext').disabled = (currentPage === totalPages);
      document.getElementById('btnPageLast').disabled = (currentPage === totalPages);
      renderPageNumbers();
    }

    function renderPageNumbers() {
      const container = document.getElementById('pageNumberButtons');
      if (!container) return;
      const pages = [];
      for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) pages.push(i);
      container.innerHTML = pages.map(p => `
        <button onclick="goToPage(${p})" class="w-7 h-7 sm:w-8 sm:h-8 rounded-xl font-mono text-xs font-bold transition interactive-btn flex items-center justify-center ${p === currentPage ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-sky-500'}">${p}</button>
      `).join('');
    }

    function goToPage(page) {
      if (page < 1 || page > totalPages) return;
      applyTrackListPagination(page);
    }

    function jumpToPageInput() {
      const val = parseInt(document.getElementById('pageJumpInput').value, 10);
      if (val >= 1 && val <= totalPages) goToPage(val);
      else showToast({ type: 'warning', title: '页码无效', message: `请输入 1 到 ${totalPages} 之间的有效页码` });
    }

    function renderTrackTable(tracks, globalOffset = 0) {
      const tbody = document.getElementById('trackListBody');
      if (!tracks || tracks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-slate-400">未匹配到任何歌曲曲目</td></tr>';
        return;
      }
      tbody.innerHTML = tracks.map((track, idx) => `
        <tr class="hover:bg-slate-100/50 dark:hover:bg-slate-900/60 transition group">
          <td class="py-3 px-4 font-mono text-center text-slate-400">${globalOffset + idx + 1}</td>
          <td class="py-3 px-4 min-w-0">
            <div class="font-bold text-slate-900 dark:text-white truncate group-hover:text-sky-500 transition-colors">${track.name}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">${track.artist || '未知艺人'}</div>
          </td>
          <td class="py-3 px-4 text-slate-600 dark:text-slate-300 truncate max-w-[160px]">${track.album || '-'}</td>
          <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/10 text-sky-500 border border-sky-500/20 font-mono uppercase">${track.source || 'NCM'}</span></td>
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="flex items-center justify-end space-x-1.5">
              <button onclick="playSingleTrack(${idx})" class="p-1.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500 hover:text-white transition interactive-btn" title="立即播放"><i data-lucide="play" class="w-3.5 h-3.5"></i></button>
              <button onclick="addSingleTrackToQueue(${idx})" class="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-sky-500 transition interactive-btn" title="加入播放队列"><i data-lucide="plus" class="w-3.5 h-3.5"></i></button>
              <button onclick="testInWorkbench('${track.id}', '${track.name}')" class="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-500 transition interactive-btn" title="填入调试台"><i data-lucide="terminal" class="w-3.5 h-3.5"></i></button>
            </div>
          </td>
        </tr>`).join('');
      lucide.createIcons();
    }

    function playSingleTrack(idx) {
      const track = currentSearchResults[idx];
      if (!track) return;
      playQueue.unshift(track);
      currentQueueIndex = 0;
      playSongItem(track);
    }

    function addSingleTrackToQueue(idx) {
      const track = currentSearchResults[idx];
      if (!track) return;
      playQueue.push(track);
      renderPlayerQueue();
      showToast({ type: 'success', title: '已加入队列', message: `《${track.name}》` });
    }

    function playAllSearchResults() {
      const targetList = filteredTracks.length > 0 ? filteredTracks : allFullTracks;
      if (targetList.length === 0) {
        showToast({ type: 'warning', title: '列表为空', message: '请先载入歌单或搜索歌曲' });
        return;
      }
      playQueue = [...targetList];
      currentQueueIndex = 0;
      playSongItem(playQueue[0]);
      showToast({ type: 'success', title: '开始播放全部', message: `已载入 ${playQueue.length} 首曲目` });
    }

    function addAllToQueue() {
      const targetList = filteredTracks.length > 0 ? filteredTracks : allFullTracks;
      if (targetList.length === 0) return;
      playQueue.push(...targetList);
      renderPlayerQueue();
      showToast({ type: 'success', title: '已批量添加', message: `已将 ${targetList.length} 首曲目加入队列` });
    }

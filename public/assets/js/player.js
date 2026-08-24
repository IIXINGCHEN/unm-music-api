/**
 * UNM-Server 播放器模块：音频引擎、悬浮玻璃播放器 UI、音量记忆、播放队列抽屉、LRC 歌词同步。
 * 依赖：core.js（showToast）。对外暴露 playSongItem/playTrackAt/playQueue 等供其他模块调用。
 */

// --- 播放器域共享状态 ---
let currentTrack = null;
let playQueue = [];
let currentQueueIndex = -1;
let isPlaying = false;
let playMode = 'repeat';
let lyricsData = [];
let currentLyricIndex = -1;
const audio = document.getElementById('mainAudioPlayer');

    // --- 音频播放引擎 ---
    let _seeking = false;
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      syncLyrics(audio.currentTime);
      const pct = String((audio.currentTime / audio.duration) * 100);
      const time = formatTime(audio.currentTime);
      for (const id of ['playerProgress', 'expandProgress']) {
        const progressEl = document.getElementById(id);
        if (_seeking && id === 'playerProgress') continue;
        if (!progressEl) continue;
        progressEl.value = pct;
        const curEl = document.getElementById(id === 'playerProgress' ? 'playerCurTime' : 'expandCurTime');
        if (curEl) curEl.textContent = time;
      }
    });

    audio.addEventListener('loadedmetadata', () => {
      if (!audio.duration) return;
      const dur = formatTime(audio.duration);
      for (const id of ['playerDurTime', 'expandDurTime']) {
        const durEl = document.getElementById(id);
        if (durEl) durEl.textContent = dur;
      }
    });

    audio.addEventListener('play', () => syncPlayerPlayState(true));
    audio.addEventListener('pause', () => syncPlayerPlayState(false));

    audio.addEventListener('ended', () => {
      if (playMode === 'single') {
        audio.currentTime = 0;
        audio.play();
      } else if (currentQueueIndex < playQueue.length - 1) {
        playTrackAt(currentQueueIndex + 1);
      } else if (playQueue.length > 0 && playMode === 'repeat') {
        playTrackAt(0);
      }
    });

    // 判定是否需要经 /stream 同源中转：
    // 1. https 下的 http 明文流（解决浏览器 Mixed Content 拦截）
    // 2. 具备严格 Referer / Origin 防盗链校验或分块传输校验的音源 CDN（JOOX / 咪咕 / B站 / 酷狗 / 酷我 / 腾讯等）
    function shouldRouteViaStream(url) {
      if (!url) return false;
      if (location.protocol === 'https:' && url.startsWith('http://')) return true;
      return /joox|stream\.music|bilivideo|akamaized\.net|bilibili|\.m4s|migu\.cn|kugou\.com|kuwo\.cn|qq\.com|163\.com|126\.net/i.test(url);
    }

    // 连续失败计数：整张队列全部失败后停止自动跳曲，避免无限循环
    let _consecutiveFailures = 0;
    audio.addEventListener('playing', () => { _consecutiveFailures = 0; });
    audio.addEventListener('error', () => {
      // 错误自动降级：若直连播放失败且尚未走 /stream，自动切换至服务端双通道中转兜底
      if (currentTrack && currentTrack._rawUrl && !audio.src.includes('/stream?url=')) {
        console.warn('[Player] 直连播放失败，自动切换至 /stream 双通道代理中转重试...');
        audio.src = `/stream?url=${encodeURIComponent(currentTrack._rawUrl)}`;
        audio.play().catch(() => {});
        return;
      }

      _consecutiveFailures++;
      const inQueue = currentQueueIndex >= 0 && currentQueueIndex < playQueue.length;
      const hasNext = currentQueueIndex >= 0 && currentQueueIndex < playQueue.length - 1;
      if (inQueue && hasNext && _consecutiveFailures <= playQueue.length) {
        const failedName = (playQueue[currentQueueIndex] || {}).name || '当前曲目';
        showToast({ type: 'warning', title: '已跳过失效曲目', message: `《${failedName}》音源不可用，自动切换下一首` });
        // 锁定目标索引：延迟窗口内若用户已手动切歌则放弃自动跳曲，避免双重跳转
        const targetIndex = currentQueueIndex + 1;
        setTimeout(() => { if (currentQueueIndex === targetIndex - 1) playTrackAt(targetIndex); }, 300);
      } else {
        showToast({ type: 'error', title: '音频播放失败', message: '直链已失效或跨域受限；可重新点击播放（将绕过缓存重新匹配音源）' });
      }
    });

    function formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return '00:00';
      const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
      return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // --- 悬浮玻璃播放器 ---
    const playerBarEl = document.getElementById('playerBar');
    const playerVinylEl = document.getElementById('playerVinyl');
    const playerProgressEl = document.getElementById('playerProgress');
    const playerCoverImg = document.getElementById('playerCoverImg');
    let _playerQueueOpen = false;

    function showPlayerBar() {
      playerBarEl.classList.remove('translate-y-8', 'opacity-0', 'pointer-events-none');
      // 播放器为 fixed 悬浮层，不改变文档流：页脚保持固定，不再被拉伸下移
      syncBackToTopPosition();
      renderPlayerQueue();
    }
    function hidePlayerBar() {
      playerBarEl.classList.add('translate-y-8', 'opacity-0', 'pointer-events-none');
      syncBackToTopPosition();
    }
    function setPlayerPlayIcon(playing) {
      for (const id of ['playerPlayBtn', 'expandPlayBtn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        const size = id === 'expandPlayBtn' ? 'w-6 h-6' : 'w-5 h-5';
        btn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}" class="${size} ${playing || id === 'expandPlayBtn' ? '' : 'ml-0.5'}"></i>`;
      }
      lucide.createIcons();
    }
    function syncPlayerPlayState(playing) {
      isPlaying = playing;
      setPlayerPlayIcon(playing);
      // 黑胶旋转与光晕：迷你条 + 展开视图同步
      for (const vinylId of ['playerVinyl', 'expandVinyl']) {
        const v = document.getElementById(vinylId);
        if (v) v.classList.toggle('animate-spin-slow', playing);
      }
      for (const glowId of ['playerCoverGlow', 'expandCoverGlow']) {
        const g = document.getElementById(glowId);
        if (!g) continue;
        g.classList.toggle('opacity-100', playing);
        g.classList.toggle('opacity-0', !playing);
      }
      renderPlayerQueue();
      if (typeof window.syncIslandMusicState === 'function') {
        window.syncIslandMusicState(currentTrack, playing);
      }
    }
    function setCoverArt(imgEl, vinylEl, picUrl) {
      if (picUrl) {
        imgEl.onerror = () => { imgEl.classList.add('hidden'); vinylEl.classList.remove('hidden'); };
        imgEl.src = picUrl;
        imgEl.classList.remove('hidden');
        vinylEl.classList.add('hidden');
      } else {
        imgEl.classList.add('hidden');
        vinylEl.classList.remove('hidden');
      }
    }
    function updatePlayerMeta(track) {
      const name = track.name || '未知曲目';
      const artist = track.artist || '未知艺人';
      const source = (track.source || 'ncm').toUpperCase();
      document.getElementById('playerTitle').textContent = name;
      document.getElementById('playerArtist').textContent = artist;
      document.getElementById('playerSource').textContent = source;
      document.getElementById('playerLyricLine').textContent = '';
      setCoverArt(playerCoverImg, playerVinylEl, track.picUrl);
      // 同步展开大视图
      const exTitle = document.getElementById('expandTitle');
      if (exTitle) {
        exTitle.textContent = name;
        document.getElementById('expandArtist').textContent = artist;
        document.getElementById('expandSource').textContent = source;
        setCoverArt(document.getElementById('expandCoverImg'), document.getElementById('expandVinyl'), track.picUrl);
        renderExpandLyrics();
      }
    }
    function playerTogglePlay() {
      if (!audio.src) { if (playQueue.length > 0) playTrackAt(Math.max(currentQueueIndex, 0)); return; }
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    }
    function playerNext() {
      if (currentQueueIndex < playQueue.length - 1) playTrackAt(currentQueueIndex + 1);
      else showToast({ type: 'info', title: '没有下一首了', message: '队列已到末尾，可继续添加曲目' });
    }
    function playerPrev() {
      if (currentQueueIndex > 0) playTrackAt(currentQueueIndex - 1);
      else showToast({ type: 'info', title: '已是第一首', message: '当前位于队列开头' });
    }
    function playerToggleMode() {
      playMode = playMode === 'single' ? 'repeat' : 'single';
      for (const id of ['playerModeBtn', 'expandModeBtn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.innerHTML = `<i data-lucide="${playMode === 'single' ? 'repeat-1' : 'repeat'}" class="w-4 h-4"></i>`;
        btn.title = playMode === 'single' ? '单曲循环' : '列表循环';
      }
      lucide.createIcons();
      showToast({ type: 'info', title: '循环模式', message: playMode === 'single' ? '已切换为单曲循环' : '已切换为列表循环' });
    }
    function playerClose() {
      audio.pause();
      hidePlayerBar();
    }

    // --- 音量控制（localStorage 记忆，迷你条与展开视图双向同步） ---
    const playerVolEl = document.getElementById('playerVolSlider');
    const expandVolEl = document.getElementById('expandVolSlider');
    function applyVolume(v) {
      audio.volume = v;
      audio.muted = false;
      const icon = `<i data-lucide="${v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2'}" class="w-4 h-4"></i>`;
      for (const id of ['playerMuteBtn', 'expandMuteBtn']) {
        const btn = document.getElementById(id);
        if (btn) btn.innerHTML = icon;
      }
      for (const el of [playerVolEl, expandVolEl]) {
        if (el && parseInt(el.value, 10) !== Math.round(v * 100)) el.value = String(Math.round(v * 100));
      }
      lucide.createIcons();
      try { localStorage.setItem('unmPlayerVolume', String(v)); } catch (e) {}
    }
    if (playerVolEl) {
      let saved = 0.8;
      try { const s = parseFloat(localStorage.getItem('unmPlayerVolume')); if (!isNaN(s)) saved = Math.min(1, Math.max(0, s)); } catch (e) {}
      playerVolEl.value = String(saved * 100);
      audio.volume = saved;
      playerVolEl.addEventListener('input', () => applyVolume(parseInt(playerVolEl.value, 10) / 100));
      if (expandVolEl) expandVolEl.addEventListener('input', () => applyVolume(parseInt(expandVolEl.value, 10) / 100));
      document.getElementById('playerMuteBtn').addEventListener('click', () => {
        if (audio.muted || audio.volume === 0) {
          applyVolume(parseInt(playerVolEl.value, 10) / 100 || 0.8);
        } else {
          audio.muted = true;
          document.getElementById('playerMuteBtn').innerHTML = '<i data-lucide="volume-x" class="w-4 h-4"></i>';
          lucide.createIcons();
        }
      });
    }

    // --- 播放队列抽屉 ---
    function renderPlayerQueue() {
      const list = document.getElementById('playerQueueList');
      const count = document.getElementById('playerQueueCount');
      if (!list || !count) return;
      count.textContent = String(playQueue.length);
      if (playQueue.length === 0) {
        list.innerHTML = '<div class="py-6 text-center text-xs text-slate-400 dark:text-slate-500">队列为空 · 可在曲目列表点击「+」加入</div>';
        return;
      }
      list.innerHTML = playQueue.map((t, i) => {
        const active = i === currentQueueIndex;
        return `<div onclick="playQueueIndex(${i})" class="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer transition interactive-btn ${active ? 'bg-sky-500/10 border border-sky-500/30' : 'border border-transparent hover:bg-slate-100 dark:hover:bg-white/5'}">
          <span class="w-5 flex-shrink-0 text-center font-mono text-[10px] ${active ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400'}">${active && isPlaying ? '<span class=\'inline-flex items-end h-3 gap-[2px]\'><span class=\'w-[3px] bg-sky-400 animate-wave-1\'></span><span class=\'w-[3px] bg-sky-400 animate-wave-3\'></span><span class=\'w-[3px] bg-sky-400 animate-wave-4\'></span></span>' : (i + 1)}</span>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold truncate ${active ? 'text-sky-600 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300'}">${t.name}</div>
            <div class="text-[10px] text-slate-400 truncate">${t.artist || ''}</div>
          </div>
          <button onclick="event.stopPropagation();removeFromQueue(${i})" aria-label="从队列移除" class="p-1 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-white/5 transition opacity-0 group-hover:opacity-100"><i data-lucide="x" class="w-3 h-3"></i></button>
        </div>`;
      }).join('');
      lucide.createIcons();
    }
    function playQueueIndex(i) {
      if (i < 0 || i >= playQueue.length) return;
      currentQueueIndex = i;
      playSongItem(playQueue[i]);
    }
    function removeFromQueue(i) {
      if (i < 0 || i >= playQueue.length) return;
      playQueue.splice(i, 1);
      if (i < currentQueueIndex) currentQueueIndex--;
      renderPlayerQueue();
    }
    function clearQueue() {
      playQueue = [];
      currentQueueIndex = -1;
      renderPlayerQueue();
      showToast({ type: 'info', title: '队列已清空', message: '当前曲目将继续播放' });
    }
    function playerToggleQueue() {
      _playerQueueOpen = !_playerQueueOpen;
      document.getElementById('playerQueuePanel').classList.toggle('hidden', !_playerQueueOpen);
      if (_playerQueueOpen) renderPlayerQueue();
    }

    // --- 进度条拖拽（迷你条 + 展开视图） ---
    if (playerProgressEl) {
      playerProgressEl.addEventListener('input', () => { _seeking = true; });
      playerProgressEl.addEventListener('change', () => {
        if (audio.duration) audio.currentTime = (parseFloat(playerProgressEl.value) / 100) * audio.duration;
        _seeking = false;
      });
    }
    const expandProgressEl = document.getElementById('expandProgress');
    if (expandProgressEl) {
      expandProgressEl.addEventListener('input', () => { _seeking = true; });
      expandProgressEl.addEventListener('change', () => {
        if (audio.duration) audio.currentTime = (parseFloat(expandProgressEl.value) / 100) * audio.duration;
        _seeking = false;
      });
    }

    // --- 展开大视图（专业播放面板） ---
    function openPlayerExpand() {
      if (!currentTrack && playQueue.length === 0) {
        showToast({ type: 'info', title: '暂无播放内容', message: '请先播放一首歌曲' });
        return;
      }
      const overlay = document.getElementById('playerExpand');
      overlay.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      if (currentTrack) updatePlayerMeta(currentTrack);
      // 同步当前进度与播放态
      if (audio.duration) {
        document.getElementById('expandProgress').value = String((audio.currentTime / audio.duration) * 100);
        document.getElementById('expandCurTime').textContent = formatTime(audio.currentTime);
        document.getElementById('expandDurTime').textContent = formatTime(audio.duration);
      }
      setPlayerPlayIcon(!audio.paused);
      lucide.createIcons();
    }
    function closePlayerExpand() {
      document.getElementById('playerExpand').classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePlayerExpand();
    });

    // --- 一键回到顶部 ---
    function scrollToTopSmooth() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const backToTopEl = document.getElementById('backToTopBtn');
    function syncBackToTopVisibility() {
      if (!backToTopEl) return;
      const show = window.scrollY > 400;
      backToTopEl.classList.toggle('opacity-0', !show);
      backToTopEl.classList.toggle('translate-y-4', !show);
      backToTopEl.classList.toggle('pointer-events-none', !show);
    }
    function syncBackToTopPosition() {
      if (!backToTopEl) return;
      const playerVisible = !playerBarEl.classList.contains('translate-y-8');
      // 播放器可见时，回到顶部按钮上移避让（桌面 260px / 移动 250px）
      backToTopEl.classList.toggle('sm:bottom-[264px]', playerVisible);
      backToTopEl.classList.toggle('bottom-[248px]', playerVisible);
      backToTopEl.classList.toggle('bottom-5', !playerVisible);
      backToTopEl.classList.toggle('sm:bottom-7', !playerVisible);
    }
    window.addEventListener('scroll', syncBackToTopVisibility, { passive: true });
    syncBackToTopVisibility();

    // 解析可播放直链：跨源曲目携带 source 直取对应平台；首次失败自动绕过缓存重试一次（清理死链窗口）。
    // 码率不写死，由服务端按 DEFAULT_BITRATE 配置决定。
    async function resolveTrackAudioUrl(track) {
      const crossSource = track.source && track.source !== 'netease' ? encodeURIComponent(track.source) : '';
      const songId = encodeURIComponent(String(crossSource ? (track.urlId || track.id) : track.id));
      const buildMatchUrl = (refresh) =>
        `/match?id=${songId}${crossSource ? `&source=${crossSource}` : ''}${refresh ? '&refresh=true' : ''}`;
      let json = await (await fetch(buildMatchUrl(false))).json();
      if (!(json.code === 200 && json.data?.url)) {
        json = await (await fetch(buildMatchUrl(true))).json();
        if (!(json.code === 200 && json.data?.url)) throw new Error(json.message || '无可用音源');
      }
      return json.data.url;
    }

    async function playSongItem(track) {
      currentTrack = track;
      showToast({ type: 'info', title: '正在匹配音频', message: `正在为《${track.name}》调度高保真直链...` });
      try {
        let audioUrl = track.url;
        if (!audioUrl && track.id) {
          audioUrl = await resolveTrackAudioUrl(track);
        }
        if (!audioUrl) throw new Error('未能获取到可用直链');
        currentTrack._rawUrl = audioUrl;
        if (shouldRouteViaStream(audioUrl)) {
          // https 混合内容或防盗链音源：经服务端 /stream 中转转发
          audioUrl = `/stream?url=${encodeURIComponent(audioUrl)}`;
        }
        updatePlayerMeta(track);
        audio.src = audioUrl;
        await audio.play();
        showPlayerBar();
        showToast({ type: 'success', title: '开始播放', message: `《${track.name}》- ${track.artist}` });
        loadLyrics(track.lyricId || track.id, track.source || 'netease');
      } catch (err) {
        showToast({ type: 'error', title: '匹配失败', message: err.message || '未能成功获取直链' });
      }
    }

    function playTrackAt(index) {
      if (index < 0 || index >= playQueue.length) return;
      currentQueueIndex = index;
      playSongItem(playQueue[index]);
    }

    // --- LRC 歌词解析与同步 ---
    async function loadLyrics(id, source) {
      lyricsData = [];
      currentLyricIndex = -1;
      try {
        const res = await fetch(`/lyric?id=${id}&source=${source}`);
        const json = await res.json();
        if (json.code === 200 && json.data?.lyric) parseLRC(json.data.lyric);
      } catch (e) {}
    }

    function parseLRC(lrcText) {
      lyricsData = [];
      const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
      for (const line of lrcText.split('\n')) {
        const m = timeExp.exec(line);
        if (m) {
          const time = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseFloat('0.' + m[3]);
          const text = line.replace(timeExp, '').trim();
          if (text) lyricsData.push({ time, text });
        }
      }
      lyricsData.sort((a, b) => a.time - b.time);
    }

    function syncLyrics(currentTime) {
      if (lyricsData.length === 0 || !currentTrack) return;
      let activeIndex = -1;
      for (let i = 0; i < lyricsData.length; i++) {
        if (currentTime >= lyricsData[i].time) activeIndex = i;
        else break;
      }
      if (activeIndex !== currentLyricIndex && activeIndex !== -1) {
        currentLyricIndex = activeIndex;
        const lyricEl = document.getElementById('playerLyricLine');
        if (lyricEl) {
          lyricEl.textContent = lyricsData[activeIndex].text || '';
          lyricEl.style.opacity = '0';
          requestAnimationFrame(() => { lyricEl.style.opacity = '1'; });
        }
        // 展开大视图：高亮当前句并自动滚动到可视区中央
        const panel = document.getElementById('expandLyrics');
        if (panel) {
          panel.querySelectorAll('[data-lyric-index]').forEach(el => el.classList.remove('lyric-active', 'text-sky-500', 'dark:text-sky-300', 'font-bold', 'scale-100'));
          const activeEl = panel.querySelector(`[data-lyric-index="${activeIndex}"]`);
          if (activeEl) {
            activeEl.classList.add('lyric-active', 'text-sky-500', 'dark:text-sky-300', 'font-bold');
            const targetTop = activeEl.offsetTop - panel.clientHeight / 2 + activeEl.clientHeight / 2;
            panel.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          }
        }
      }
    }

    // --- 展开大视图歌词渲染 ---
    function renderExpandLyrics() {
      const panel = document.getElementById('expandLyrics');
      if (!panel) return;
      if (lyricsData.length === 0) {
        panel.innerHTML = '<div class="h-full flex items-center justify-center text-xs text-slate-400">暂无歌词 · 纯音乐欣赏</div>';
        return;
      }
      panel.innerHTML = lyricsData.map((l, i) =>
        `<p data-lyric-index="${i}" onclick="seekToLyric(${i})" class="lyric-line text-sm text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 py-1 transition-all duration-300">${l.text}</p>`
      ).join('');
      panel.scrollTop = 0;
    }
    function seekToLyric(i) {
      if (!audio.duration || !lyricsData[i]) return;
      audio.currentTime = lyricsData[i].time;
      syncLyrics(audio.currentTime);
    }

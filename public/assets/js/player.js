/**
 * UNM-Server 播放器模块：音频引擎、悬浮玻璃播放器 UI、音量记忆、播放队列抽屉、LRC 歌词同步。
 * 依赖：core.js（showToast）。对外暴露 playSongItem/playTrackAt/playQueue 等供其他模块调用。
 */

// HTML 转义：播放队列渲染曲名/艺人（外部 API 数据）前必须转义，阻断存储型 XSS
// （与 core.js 的全局 escapeHtml 实现一致，本地兜底以防加载顺序变化）
if (typeof escapeHtml === 'undefined') {
  var escapeHtml = function (value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
}

// --- 播放器域共享状态 ---
let currentTrack = null;
let playQueue = [];
let currentQueueIndex = -1;
let isPlaying = false;
let playMode = 'repeat';
let lyricsData = [];
let currentLyricIndex = -1;
const audio = document.getElementById('mainAudioPlayer');

// 播放失败自动换源：B 站等 CDN 可能 403（Referer/签名限制），按音源优先级逐个重试
const FALLBACK_PROVIDERS = ['gdstudio', 'pyncmd', 'bodian', 'joox'];
let lastAudioSource = '';
let fallbackAttempt = 0;
// R1：当前直链已尝试过服务端中转的 URL（每首歌重置），避免中转失败后重复试中转
let relayTriedUrl = '';

// 播放代际：每次 playSongItem 递增；异步回调（匹配/换源/歌词）写入前必须校验代际，
// 阻断快速切歌时旧请求覆盖新播放的竞态（M1）
let playGeneration = 0;

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
        progressEl.style.setProperty('--fill', pct + '%');
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

    // 播放失败/卡死自动换源：排除已失败的音源，按优先级重试其他 provider
    // M1：换源锁绑定播放代际 —— 同一代际重复触发跳过；切歌后（代际变化）新请求可接管，
    // 旧请求在 await 后经代际校验直接丢弃，不再写入 audio，也不再释放新请求的锁
    let fallbackInFlight = false;
    let fallbackGen = -1;
    async function tryFallbackSource(reason) {
      const gen = playGeneration;
      const trackAtEntry = currentTrack;
      if (fallbackInFlight && fallbackGen === gen) return;

      // R1：当前直链尚未走过服务端中转 → 先中转再换源。
      // 用户网络整段阻断 CDN 域名时直连注定失败，中转是唯一出路；
      // 放 provider 轮换之前，避免 3 次注定失败的直连等待
      const curSrc = audio.currentSrc || audio.src;
      if (trackAtEntry && curSrc && !curSrc.includes('/relay?') && relayTriedUrl !== curSrc) {
        relayTriedUrl = curSrc;
        fallbackInFlight = true;
        fallbackGen = gen;
        try {
          showToast({ type: 'info', title: '正在尝试中转', message: '直连被阻断，尝试经由服务端中转播放…' });
          stopStallWatchdog();
          audio.src = '/relay?url=' + encodeURIComponent(curSrc);
          await audio.play();
          // 代际校验：play() 期间用户已切歌则不再报"中转播放中"
          if (gen !== playGeneration || trackAtEntry !== currentTrack) return;
          showToast({ type: 'success', title: '中转播放中', message: '已切换到服务端中转链路' });
          return;
        } catch (e) {
          // 被新 load 中断或已有更新的播放流程接管：静默返回，不误报
          if ((e && e.name === 'AbortError') || gen !== playGeneration || trackAtEntry !== currentTrack) return;
          // 中转也失败 → 继续走下面的 provider 轮换
        } finally {
          if (fallbackGen === gen) { fallbackInFlight = false; fallbackGen = -1; }
        }
      }

      if (!trackAtEntry || !trackAtEntry.id || fallbackAttempt >= FALLBACK_PROVIDERS.length) {
        showToast({ type: 'error', title: '音频播放失败', message: '直连与服务端中转均不可用（可在服务端配置 PROXY_URL 使用外部代理）' });
        return;
      }
      fallbackInFlight = true;
      fallbackGen = gen;
      try {
        const failedSource = lastAudioSource;
        const candidates = FALLBACK_PROVIDERS.filter(s => s !== failedSource);
        const nextServer = candidates[fallbackAttempt % Math.max(candidates.length, 1)];
        fallbackAttempt++;
        if (nextServer) {
          showToast({ type: 'info', title: '正在换源', message: `${failedSource || '当前'}音源不可用${reason ? `（${reason}）` : ''}，尝试 ${nextServer}…` });
          const r = await fetch(`/match?id=${encodeURIComponent(trackAtEntry.id)}&server=${nextServer}&br=999`);
          const d = await r.json();
          // 代际校验：切歌后旧换源结果一律丢弃
          if (gen !== playGeneration || trackAtEntry !== currentTrack) return;
          if (d.code === 200 && d.data && d.data.url) {
            lastAudioSource = d.data.source || nextServer;
            let url = d.data.url;
            if (location.protocol === 'https:' && url.startsWith('http://')) {
              url = url.replace(/^http:\/\//, 'https://');
            }
            stopStallWatchdog();
            audio.src = url;
            await audio.play();
            // 代际校验：play() 期间用户已切歌则不再报"换源成功"，新流程自己会报
            if (gen !== playGeneration || trackAtEntry !== currentTrack) return;
            showToast({ type: 'success', title: '换源成功', message: `已切换到 ${lastAudioSource} 音源` });
            return;
          }
        }
      } catch (e) {
        // play() 被新的 load 中断（AbortError）或已有更新的播放流程（换源/切歌）接管：
        // 接管方会自己报告结果，这里再报"音频播放失败"是误报，静默返回
        if ((e && e.name === 'AbortError') || gen !== playGeneration || trackAtEntry !== currentTrack) return;
        /* 继续走下面的失败提示 */
      }
      finally {
        // 只有同一代际的请求才能释放锁，防止旧请求吞掉新请求的换源
        if (fallbackGen === gen) { fallbackInFlight = false; fallbackGen = -1; }
      }
      showToast({ type: 'error', title: '音频播放失败', message: '直连与服务端中转均不可用（可在服务端配置 PROXY_URL 使用外部代理）' });
    }

    audio.addEventListener('error', () => tryFallbackSource(''));

    // 卡死看门狗：Joox 等 CDN 偶发 206 分片长度异常（ERR_CONTENT_LENGTH_MISMATCH），
    // 此时不触发 error 事件、只会假死（waiting），8 秒无进展则走换源拿新的 vkey 直链
    let stallCheckTimer = null;
    function stopStallWatchdog() {
      if (stallCheckTimer) { clearTimeout(stallCheckTimer); stallCheckTimer = null; }
    }
    function startStallWatchdog() {
      stopStallWatchdog();
      const posAtStart = audio.currentTime;
      stallCheckTimer = setTimeout(() => {
        if (!audio.paused && !audio.ended && audio.readyState < 3 && Math.abs(audio.currentTime - posAtStart) < 0.5) {
          tryFallbackSource('音频流卡死');
        }
      }, 8000);
    }
    audio.addEventListener('waiting', startStallWatchdog);
    audio.addEventListener('playing', stopStallWatchdog);
    audio.addEventListener('pause', stopStallWatchdog);

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
    }
    function setCoverArt(imgEl, vinylEl, picUrl) {
      if (picUrl) {
        imgEl.onerror = () => {
          const cur = imgEl.src || '';
          // 网易云 p1 CDN 偶发拒绝连接：先试一次 p2 镜像 host
          if (cur.includes('://p1.music.126.net/') && !imgEl.dataset.fbk) {
            imgEl.dataset.fbk = 'p2';
            imgEl.src = cur.replace('://p1.music.126.net/', '://p2.music.126.net/');
            return;
          }
          // R1：整段 CDN 被阻断时走服务端中转（与音频同一链路）
          if (!cur.includes('/relay?') && !imgEl.dataset.relayed) {
            imgEl.dataset.relayed = '1';
            imgEl.src = '/relay?url=' + encodeURIComponent(cur);
            return;
          }
          delete imgEl.dataset.fbk;
          delete imgEl.dataset.relayed;
          imgEl.classList.add('hidden'); vinylEl.classList.remove('hidden');
        };
        delete imgEl.dataset.fbk;
        delete imgEl.dataset.relayed;
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
            <div class="text-xs font-bold truncate ${active ? 'text-sky-600 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300'}">${escapeHtml(t.name)}</div>
            <div class="text-[10px] text-slate-400 truncate">${escapeHtml(t.artist || '')}</div>
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

    async function playSongItem(track) {
      const myGen = ++playGeneration;   // M1：本次播放的代际，旧请求的异步回调一律作废
      currentTrack = track;
      showToast({ type: 'info', title: '正在匹配音频', message: `正在为《${track.name}》调度高保真直链...` });
      try {
        let audioUrl = track.url;
        fallbackAttempt = 0;
        relayTriedUrl = '';
        lastAudioSource = track.source || '';
        if (!audioUrl && track.id) {
          const matchRes = await fetch(`/match?id=${encodeURIComponent(track.id)}&br=999`);
          const matchData = await matchRes.json();
          if (matchData.code === 200 && matchData.data?.url) {
            audioUrl = matchData.data.url;
            lastAudioSource = matchData.data.source || lastAudioSource;
          } else {
            throw new Error(matchData.message || '无可用音源');
          }
        }
        if (location.protocol === 'https:' && audioUrl.startsWith('http://')) {
          audioUrl = audioUrl.replace(/^http:\/\//, 'https://');
        }
        // M1 代际校验：切歌后旧请求不再写入音频元素
        if (myGen !== playGeneration) return;
        updatePlayerMeta(track);
        audio.src = audioUrl;
        await audio.play();
        if (myGen !== playGeneration) return;
        showPlayerBar();
        showToast({ type: 'success', title: '开始播放', message: `《${track.name}》- ${track.artist}` });
        loadLyrics(track.id, track.source || 'netease');
      } catch (err) {
        // play() 被新的 load 中断（AbortError）说明换源/切歌的新流程已接管，
        // 它会自己报告结果；这里再报"匹配失败"是误报（常见于 CDN 掐连接触发换源时）
        if ((err && err.name === 'AbortError') || myGen !== playGeneration) return;
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
        // L2：id/source 统一 encodeURIComponent（与 tryFallbackSource 一致），防 &/# 截断参数
        const res = await fetch(`/lyric?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`);
        const json = await res.json();
        // M3 归属校验：返回时已切歌则丢弃，避免旧歌词覆盖新曲目
        if (!currentTrack || currentTrack.id !== id) return;
        if (json.code === 200 && json.data?.lyric) parseLRC(json.data.lyric);
      } catch (e) {}
    }

    function parseLRC(lrcText) {
      lyricsData = [];
      const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
      for (const line of lrcText.split('\n')) {
        // L5：一行可能含多个时间戳（如 [00:10.00][00:20.00]副歌），循环收集全部；
        // 每次处理新行前重置 lastIndex，避免 /g 正则跨行状态污染
        timeExp.lastIndex = 0;
        const times = [];
        let m;
        while ((m = timeExp.exec(line)) !== null) {
          times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseFloat('0.' + m[3]));
        }
        if (times.length === 0) continue;
        const text = line.replace(timeExp, '').trim();
        if (!text) continue;
        for (const time of times) lyricsData.push({ time, text });
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
        // H1：歌词来自第三方上游（可含 HTML），必须转义后拼接，阻断存储型 XSS
        `<p data-lyric-index="${i}" onclick="seekToLyric(${i})" class="lyric-line text-sm text-slate-400 dark:text-slate-500 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 py-1 transition-all duration-300">${escapeHtml(l.text)}</p>`
      ).join('');
      panel.scrollTop = 0;
    }
    function seekToLyric(i) {
      if (!audio.duration || !lyricsData[i]) return;
      audio.currentTime = lyricsData[i].time;
      syncLyrics(audio.currentTime);
    }

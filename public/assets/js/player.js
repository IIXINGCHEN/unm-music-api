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
      const progressEl = document.getElementById('playerProgress');
      if (!_seeking && progressEl) {
        progressEl.value = String((audio.currentTime / audio.duration) * 100);
        const curEl = document.getElementById('playerCurTime');
        if (curEl) curEl.textContent = formatTime(audio.currentTime);
      }
    });

    audio.addEventListener('loadedmetadata', () => {
      if (!audio.duration) return;
      const durEl = document.getElementById('playerDurTime');
      if (durEl) durEl.textContent = formatTime(audio.duration);
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

    audio.addEventListener('error', () => {
      showToast({ type: 'error', title: '音频播放失败', message: '直链已失效、HTTPS 升级后音源不可达，或跨域受限（可在服务端配置 PROXY_URL 中转）' });
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
      if (!document.body.dataset.pbOriginal) document.body.dataset.pbOriginal = document.body.style.paddingBottom || '';
      document.body.style.paddingBottom = '240px';
      renderPlayerQueue();
    }
    function hidePlayerBar() {
      playerBarEl.classList.add('translate-y-8', 'opacity-0', 'pointer-events-none');
      document.body.style.paddingBottom = document.body.dataset.pbOriginal || '';
    }
    function setPlayerPlayIcon(playing) {
      const btn = document.getElementById('playerPlayBtn');
      btn.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}" class="w-5 h-5 ${playing ? '' : 'ml-0.5'}"></i>`;
      lucide.createIcons();
    }
    function syncPlayerPlayState(playing) {
      isPlaying = playing;
      setPlayerPlayIcon(playing);
      playerVinylEl.classList.toggle('animate-spin-slow', playing);
      document.getElementById('playerCoverGlow').classList.toggle('opacity-100', playing);
      document.getElementById('playerCoverGlow').classList.toggle('opacity-0', !playing);
      renderPlayerQueue();
    }
    function updatePlayerMeta(track) {
      document.getElementById('playerTitle').textContent = track.name || '未知曲目';
      document.getElementById('playerArtist').textContent = track.artist || '未知艺人';
      document.getElementById('playerSource').textContent = (track.source || 'ncm').toUpperCase();
      document.getElementById('playerLyricLine').textContent = '';
      if (track.picUrl) {
        playerCoverImg.onerror = () => { playerCoverImg.classList.add('hidden'); playerVinylEl.classList.remove('hidden'); };
        playerCoverImg.src = track.picUrl;
        playerCoverImg.classList.remove('hidden');
        playerVinylEl.classList.add('hidden');
      } else {
        playerCoverImg.classList.add('hidden');
        playerVinylEl.classList.remove('hidden');
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
      const btn = document.getElementById('playerModeBtn');
      btn.innerHTML = `<i data-lucide="${playMode === 'single' ? 'repeat-1' : 'repeat'}" class="w-4 h-4"></i>`;
      btn.title = playMode === 'single' ? '单曲循环' : '列表循环';
      lucide.createIcons();
      showToast({ type: 'info', title: '循环模式', message: playMode === 'single' ? '已切换为单曲循环' : '已切换为列表循环' });
    }
    function playerClose() {
      audio.pause();
      hidePlayerBar();
    }

    // --- 音量控制（localStorage 记忆） ---
    const playerVolEl = document.getElementById('playerVolSlider');
    function applyVolume(v) {
      audio.volume = v;
      audio.muted = false;
      const btn = document.getElementById('playerMuteBtn');
      btn.innerHTML = `<i data-lucide="${v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2'}" class="w-4 h-4"></i>`;
      lucide.createIcons();
      try { localStorage.setItem('unmPlayerVolume', String(v)); } catch (e) {}
    }
    if (playerVolEl) {
      let saved = 0.8;
      try { const s = parseFloat(localStorage.getItem('unmPlayerVolume')); if (!isNaN(s)) saved = Math.min(1, Math.max(0, s)); } catch (e) {}
      playerVolEl.value = String(saved * 100);
      audio.volume = saved;
      playerVolEl.addEventListener('input', () => applyVolume(parseInt(playerVolEl.value, 10) / 100));
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

    // --- 进度条拖拽 ---
    if (playerProgressEl) {
      playerProgressEl.addEventListener('input', () => { _seeking = true; });
      playerProgressEl.addEventListener('change', () => {
        if (audio.duration) audio.currentTime = (parseFloat(playerProgressEl.value) / 100) * audio.duration;
        _seeking = false;
      });
    }

    async function playSongItem(track) {
      currentTrack = track;
      showToast({ type: 'info', title: '正在匹配音频', message: `正在为《${track.name}》调度高保真直链...` });
      try {
        let audioUrl = track.url;
        if (!audioUrl && track.id) {
          const matchRes = await fetch(`/match?id=${track.id}&br=999`);
          const matchData = await matchRes.json();
          if (matchData.code === 200 && matchData.data?.url) {
            audioUrl = matchData.data.url;
          } else {
            throw new Error(matchData.message || '无可用音源');
          }
        }
        if (location.protocol === 'https:' && audioUrl.startsWith('http://')) {
          audioUrl = audioUrl.replace(/^http:\/\//, 'https://');
        }
        updatePlayerMeta(track);
        audio.src = audioUrl;
        await audio.play();
        showPlayerBar();
        showToast({ type: 'success', title: '开始播放', message: `《${track.name}》- ${track.artist}` });
        loadLyrics(track.id, track.source || 'netease');
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
      }
    }

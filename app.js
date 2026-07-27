// ── State ──────────────────────────────────────────────────────
let lyrics = [], currentLyricIdx = -1, syncOffset = 0;
let syncInterval = null, wordInterval = null;
let micStream = null, audioCtx = null, analyser = null, micActive = false;
let score = 0, totalLines = 0, sungLines = 0, combo = 0, maxCombo = 0, missedLines = 0;
let ytPlayer = null, ytReady = false;
let currentTheme = localStorage.getItem('kk-theme') || 'neon';
let serverInfo = { localIp: 'localhost', port: 8765 };

async function loadServerInfo() {
  try {
    const r = await fetch('/api/server-info');
    if (r.ok) {
      serverInfo = await r.json();
    }
  } catch (e) {
    console.error('Falha ao obter info do servidor:', e);
  }
}
loadServerInfo();
renderSingersDatalist();

// ── Tabs ──────────────────────────────────────────────────────────
function switchTab(tab) {
  ['busca','reacoes','lista','historico','disputa','ranking'].forEach(t => {
    const panel = document.getElementById('tab-' + t);
    const btn   = document.getElementById('tab-btn-' + t);
    if (!panel || !btn) return;
    const active = t === tab;
    panel.style.display = active ? 'block' : 'none';
    btn.style.color = active ? 'var(--text)' : 'var(--sub)';
    btn.style.fontWeight = active ? '700' : '600';
    btn.style.borderBottomColor = active ? 'var(--c1)' : 'transparent';
  });
}

// ── Pitch Chart State ─────────────────────────────────────────────
let pitchHistory = [];
const MAX_HISTORY_POINTS = 180;
const MIDI_MIN = 48; // C3
const MIDI_MAX = 80; // G#5
let canvas = null, ctx = null, chartAnimId = null;
let particles = [];


// ── YouTube API ──────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => { ytReady = true; };
(function(){ const s=document.createElement('script'); s.src='https://www.youtube.com/iframe_api'; document.head.appendChild(s); })();

// ── Theme ────────────────────────────────────────────────────────
function applyTheme(t) {
  currentTheme = t;
  document.body.className = t === 'neon' ? '' : `theme-${t}`;
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === t));
  localStorage.setItem('kk-theme', t);
}

// ── History (localStorage) ────────────────────────────────────────
function getHistory() { return JSON.parse(localStorage.getItem('kk-history') || '[]'); }
function saveHistory(entry) {
  let h = getHistory().filter(e => e.url !== entry.url);
  h.unshift(entry); h = h.slice(0, 60); // Save up to 60 entries for deep autocomplete lists
  localStorage.setItem('kk-history', JSON.stringify(h));
  renderHistory();
}

function saveSingerName(singer) {
  if (!singer) return;
  const singerName = singer.trim();
  if (!singerName) return;

  let savedSingers = JSON.parse(localStorage.getItem('kk-saved-singers') || '[]');
  savedSingers = savedSingers.filter(s => s.toLowerCase() !== singerName.toLowerCase());
  savedSingers.unshift(singerName);
  savedSingers = savedSingers.slice(0, 30);
  
  localStorage.setItem('kk-saved-singers', JSON.stringify(savedSingers));
  renderSingersDatalist();
}

function renderSingersDatalist() {
  const savedSingers = JSON.parse(localStorage.getItem('kk-saved-singers') || '[]');
  const datalist = document.getElementById('singers-list');
  if (datalist) {
    datalist.innerHTML = savedSingers.map(s => `<option value="${s}">`).join('');
  }
}
function renderHistory() {
  const wrap = document.getElementById('history-wrap');
  const h = getHistory();
  
  // Extract unique values for inputs datalists (choices dropdowns)
  const uniqueArtists = [...new Set(h.map(e => e.artist).filter(a => a && a !== '?'))];
  const uniqueTracks = [...new Set(h.map(e => e.track).filter(t => t && t !== '?'))];
  
  const artistList = document.getElementById('artists-list');
  const trackList = document.getElementById('tracks-list');
  if (artistList) {
    artistList.innerHTML = uniqueArtists.map(a => `<option value="${a}">`).join('');
  }
  if (trackList) {
    trackList.innerHTML = uniqueTracks.map(t => `<option value="${t}">`).join('');
  }
  renderSingersDatalist();

  // Keep the visual list elegant by only showing the 6 most recent songs
  const visualH = h.slice(0, 6);
  if (!visualH.length) { 
    wrap.innerHTML = '<span style="color:var(--dim);font-size:.8rem">Nenhuma música ainda.</span>'; 
    return; 
  }
  wrap.innerHTML = visualH.map((e,i) => `
    <div class="history-pill" onclick="loadHistory(${i})" title="${e.url}">
      🎵 <span>${e.artist} - ${e.track}</span>
      ${e.score ? `<span style="color:var(--c2);font-size:.7rem">${e.score}pts</span>` : ''}
      <span class="del" onclick="event.stopPropagation();deleteHistory(${i})">✕</span>
    </div>`).join('');
    
  renderRanking();
}

function renderRanking() {
  const wrap = document.getElementById('ranking-wrap');
  if(!wrap) return;
  const h = getHistory().filter(e => e.score !== null).sort((a,b) => b.score - a.score);
  if(!h.length) { 
    wrap.innerHTML = '<span style="color:var(--dim);font-size:.8rem">Nenhuma nota ainda.</span>'; 
    return; 
  }
  
  wrap.innerHTML = h.map((e, i) => `
    <div style="display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:10px; margin-bottom:8px;">
      <div style="font-size:1.6rem; font-weight:900; color:${i===0?'#ffd54f':i===1?'#b0bec5':i===2?'#ff8a65':'var(--dim)'}; width:40px; text-align:center;">#${i+1}</div>
      <div style="flex:1; overflow:hidden;">
        <div style="font-weight:800; color:var(--text); font-size:1rem; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${e.singer || 'Anônimo'} <span style="color:var(--c2); margin-left:6px;">${e.score} pts</span></div>
        <div style="font-size:0.8rem; color:var(--sub); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">🎵 ${e.track} <span style="opacity:0.6">(${e.artist})</span></div>
      </div>
    </div>
  `).join('');
}
let selectedHistoryItem = null;

function loadHistory(i) {
  selectedHistoryItem = getHistory()[i];
  
  // Pre-fill inputs just in case they cancel and want to edit
  document.getElementById('inp-artist').value = selectedHistoryItem.artist;
  document.getElementById('inp-track').value = selectedHistoryItem.track;
  document.getElementById('inp-url').value = selectedHistoryItem.url;
  
  // Show Modal
  document.getElementById('history-modal-song-name').textContent = `${selectedHistoryItem.artist} - ${selectedHistoryItem.track}`;
  document.getElementById('history-step-1').style.display = 'block';
  document.getElementById('history-step-2').style.display = 'none';
  document.getElementById('history-modal-overlay').style.display = 'flex';
}

function closeHistoryModal() {
  document.getElementById('history-modal-overlay').style.display = 'none';
  const inpHistorySinger = document.getElementById('history-inp-singer');
  if (inpHistorySinger) inpHistorySinger.value = '';
  selectedHistoryItem = null;
}

function historyModalNextStep() {
  document.getElementById('history-step-1').style.display = 'none';
  document.getElementById('history-step-2').style.display = 'block';
  
  // Try to pre-fill from the main search tab inputs if they already typed something
  const mainSinger = document.getElementById('inp-singer');
  const mainRounds = document.getElementById('inp-rounds');
  if (mainSinger && mainSinger.value) document.getElementById('history-inp-singer').value = mainSinger.value;
  if (mainRounds && mainRounds.value) document.getElementById('history-inp-rounds').value = mainRounds.value;
  
  document.getElementById('history-inp-singer').focus();
}

async function confirmHistoryAdd() {
  if (!selectedHistoryItem) return;
  
  const singer = document.getElementById('history-inp-singer').value.trim();
  const rounds = document.getElementById('history-inp-rounds').value.trim() || '1';
  
  if (!singer) {
    alert('⚠️ Informe o Nome do Participante!');
    return;
  }
  
  saveSingerName(singer);
  
  // Add directly via API
  await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      artist: selectedHistoryItem.artist, 
      track: selectedHistoryItem.track, 
      url: selectedHistoryItem.url, 
      singer: singer, 
      rounds: rounds 
    })
  });
  
  await syncQueue();
  switchTab('lista');
  closeHistoryModal();
}
function deleteHistory(i) {
  let h = getHistory(); h.splice(i, 1);
  localStorage.setItem('kk-history', JSON.stringify(h));
  renderHistory();
}

// ── Lyrics fetch & parse ──────────────────────────────────────────
async function fetchLyrics(artist, track) {
  try {
    const q = encodeURIComponent(`${artist} ${track}`);
    const r = await fetch(`https://lrclib.net/api/search?q=${q}`);
    const data = await r.json();
    if (!data || !data.length) return null;
    const best = data.find(d => d.syncedLyrics) || data[0];
    if (best.syncedLyrics) return parseLRC(best.syncedLyrics);
    if (best.plainLyrics) return parsePlain(best.plainLyrics);
    return null;
  } catch(e) { return null; }
}
function parseLRC(lrc) {
  return lrc.split('\n').map(line => {
    const m = line.match(/\[(\d+):(\d+\.?\d*)\](.*)/);
    if (!m) return null;
    return { time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3].trim() };
  }).filter(l => l && l.text);
}
function parsePlain(plain) {
  return plain.split('\n').filter(l => l.trim()).map((text,i) => ({ time: i*4, text }));
}

// ── URL utils ──────────────────────────────────────────────────────
function extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── Error / status display ─────────────────────────────────────────
function showErr(html) {
  const el = document.getElementById('err-msg');
  el.innerHTML = html; el.classList.remove('hidden');
}
function hideErr() { document.getElementById('err-msg').classList.add('hidden'); }
function setStartBtn(txt, disabled=false) {
  const b = document.getElementById('start-btn');
  b.textContent = txt; b.disabled = disabled;
}

// ── Mic permission (upfront) ──────────────────────────────────────
async function requestMicPermission() {
  const btn = document.getElementById('mic-perm-btn');
  try {
    const s = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    s.getTracks().forEach(t => t.stop()); // just test
    
    // Load devices into select
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const select = document.getElementById('mic-select');
    if (select && audioInputs.length > 0) {
      select.innerHTML = '';
      audioInputs.forEach((d, i) => {
        const option = document.createElement('option');
        option.value = d.deviceId;
        option.text = d.label || `Microfone ${i + 1}`;
        select.appendChild(option);
      });
      document.getElementById('mic-select-container').style.display = 'block';
    }
    
    btn.textContent = '✅ Permitido';
    btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary');
    btn.disabled = true;
    document.getElementById('mic-status').textContent = 'Selecione a entrada desejada abaixo.';
  } catch(e) {
    btn.textContent = '❌ Permissão negada';
    document.getElementById('mic-status').textContent = 'Permita o microfone nas configurações do browser.';
  }
}

// ── Start Karaoke ─────────────────────────────────────────────────
async function startKaraoke() {
  hideErr();
  
  // Solicita tela cheia imediatamente no clique do usuário
  const playerWrap = document.getElementById('player-wrap');
  if (playerWrap && playerWrap.requestFullscreen && !document.fullscreenElement) {
    playerWrap.requestFullscreen().catch(e => console.log('Fullscreen negado:', e));
  }
  
  let artist = document.getElementById('inp-artist').value.trim();
  let track  = document.getElementById('inp-track').value.trim();
  let url    = document.getElementById('inp-url').value.trim();
  
  if (!url) {
    if (playlistQueue.length > 0) {
      playNextInQueue();
      return;
    }
    showErr('⚠️ Busque e selecione uma música no YouTube primeiro!');
    return;
  }
  const vid = extractVideoId(url);
  if (!vid) { showErr('⚠️ URL inválida. Copie a URL completa do YouTube.'); return; }

  setStartBtn('⏳ Carregando letras...', true);
  lyrics = (artist && track) ? await fetchLyrics(artist, track) : null;
  if (lyrics) {
    lyrics = generateProceduralNotes(lyrics);
  }
  totalLines = lyrics ? lyrics.length : 0;
  syncOffset = 0; document.getElementById('offset-val').textContent = '0.0s';

  let w = 0; while(!ytReady && w < 5000) { await new Promise(r=>setTimeout(r,100)); w+=100; }
  if (!ytReady) { showErr('⚠️ Falha ao carregar API do YouTube. Verifique sua conexão.'); setStartBtn('🎵 Iniciar Karaokê'); return; }

  if (ytPlayer) {
    try { ytPlayer.destroy(); } catch(e) {}
    ytPlayer = null;
  }
  
  document.getElementById('yt-player-div').innerHTML = '';
  document.getElementById('player-wrap').style.display = 'block';
  ytPlayer = new YT.Player('yt-player-div', {
    height:'340', width:'100%', videoId: vid,
    playerVars:{ autoplay:1, controls:1, rel:0 },
    events:{ onReady: onPlayerReady, onError: onPlayerError, onStateChange: onStateChange }
  });

  let singer = document.getElementById('inp-singer') ? document.getElementById('inp-singer').value.trim() : '';
  saveHistory({ artist: artist||'?', track: track||'?', url, score:null, singer: singer||'Anônimo' });
  setStartBtn('🎵 Iniciar Karaokê');
}

function initKaraokeUI() {
  document.getElementById('setup-card').classList.add('hidden');
  document.getElementById('karaoke-card').classList.remove('hidden');
  score=0; sungLines=0; combo=0; maxCombo=0; missedLines=0; currentLyricIdx=-1;
  updateStatsUI();
  updateNextSongBanner();
  clearPitchHistory();
  startChartAnimation();
  showCountdown(() => {
    if (lyrics && lyrics.length) {
      startLyricSync();
    } else {
      const emptyMsg = '<div class="lyric-empty">🎵 Letras não encontradas. Tente preencher artista e música.</div>';
      document.getElementById('lyrics-stage').innerHTML = emptyMsg;
      document.getElementById('fs-prev').textContent = '';
      document.getElementById('fs-current').innerHTML = emptyMsg;
      document.getElementById('fs-next').textContent = '';
    }
  });
}

function onPlayerReady(e) {
  e.target.playVideo();
  initKaraokeUI();
}
function onPlayerError(e) {
  exitPlayerFullscreen();
  const msgs={2:'URL inválida.',5:'HTML5 não suportado.',100:'Vídeo não encontrado.',101:'Este vídeo <b>não permite incorporação</b>.',150:'Este vídeo <b>não permite incorporação</b>.'};
  document.getElementById('player-wrap').style.display='none';
  document.getElementById('setup-card').classList.remove('hidden');
  document.getElementById('karaoke-card').classList.add('hidden');
  showErr(`❌ ${msgs[e.data]||'Erro '+e.data}<br><br>
    <b>Como resolver:</b> Tente outro vídeo de karaokê. Canais como <b>Sing King</b>, <b>Karaoke Brasil</b> e <b>GK Karaoke</b> geralmente funcionam.`);
  if(ytPlayer){try{ytPlayer.destroy();}catch(ex){} ytPlayer=null;}
}
function onStateChange(e) { if(e.data===0) stopKaraoke(); }

// ── Countdown ──────────────────────────────────────────────────────
function showCountdown(cb) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-num');
  
  // Preenche dados da música
  const artist = document.getElementById('inp-artist').value.trim() || 'Desconhecido';
  const track  = document.getElementById('inp-track').value.trim() || 'Desconhecida';
  const singer = document.getElementById('inp-singer').value.trim() || 'Usuário Local';
  
  const cdSinger = document.getElementById('cd-singer');
  const cdTrack = document.getElementById('cd-track');
  const cdArtist = document.getElementById('cd-artist');
  if (cdSinger) cdSinger.textContent = singer;
  if (cdTrack) cdTrack.textContent = track;
  if (cdArtist) cdArtist.textContent = artist;

  let n = 3;
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  numEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(iv); overlay.style.display = 'none'; overlay.classList.remove('show'); cb(); return; }
    numEl.style.animation='none'; void numEl.offsetWidth; numEl.style.animation='';
    numEl.textContent = n === 0 ? '🎤' : n;
  }, 900);
}

// ── Lyric Sync ─────────────────────────────────────────────────────
function startLyricSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const t = ytPlayer.getCurrentTime() + syncOffset;
    let idx = -1;
    for (let i=0; i<lyrics.length; i++) { if (lyrics[i].time <= t) idx=i; }
    if (idx !== currentLyricIdx) {
      if (micActive && currentLyricIdx >= 0) scoreLine();
      currentLyricIdx = idx;
      renderLyrics(idx);
      renderFsLyrics(idx);
    }
  }, 120);
}

function renderLyrics(idx) {
  const stage = document.getElementById('lyrics-stage');
  if (idx < 0) { stage.innerHTML='<div class="lyric-empty">♪ Aguardando...</div>'; return; }
  const prev = idx>0 ? lyrics[idx-1].text : '';
  const curr = lyrics[idx].text;
  const next = idx<lyrics.length-1 ? lyrics[idx+1].text : '';
  const words = curr.split(' ');
  const wordSpans = words.map((w,i)=>`<span class="lyric-word" id="lw-${i}">${w}</span>`).join(' ');
  stage.innerHTML = `
    ${prev ? `<div class="lyric-dim">${prev}</div>` : ''}
    <div class="lyric-active-wrap">${wordSpans}</div>
    ${next ? `<div class="lyric-dim">${next}</div>` : ''}
  `;
  animateWords(words, idx);
}

function animateWords(words, lineIdx) {
  if (wordInterval) clearInterval(wordInterval);
  if (!words.length) return;
  const dur = lineIdx < lyrics.length-1 ? (lyrics[lineIdx+1].time - lyrics[lineIdx].time) * 1000 : 4000;
  const perWord = Math.max(120, dur / words.length);
  let wi = 0;
  const tick = () => {
    if (wi >= words.length) { clearInterval(wordInterval); return; }
    for (let i=0; i<words.length; i++) {
      const el = document.getElementById(`lw-${i}`);
      if (!el) continue;
      el.className = 'lyric-word ' + (i < wi ? 'done' : i===wi ? 'current' : 'upcoming');
    }
    wi++;
  };
  tick();
  wordInterval = setInterval(tick, perWord);
}

function renderFsLyrics(idx) {
  if (idx < 0) return;
  const prev = idx>0 ? lyrics[idx-1].text : '';
  const curr = lyrics[idx].text;
  const next = idx<lyrics.length-1 ? lyrics[idx+1].text : '';
  document.getElementById('fs-prev').textContent = prev;
  document.getElementById('fs-current').innerHTML = curr.split(' ').map((w,i)=>`<span class="lyric-word" id="fs-lw-${i}">${w}</span>`).join(' ');
  document.getElementById('fs-next').textContent = next;
  // animate fs words too
  const words = curr.split(' ');
  const lineIdx = idx;
  const dur = lineIdx < lyrics.length-1 ? (lyrics[lineIdx+1].time - lyrics[lineIdx].time)*1000 : 4000;
  const perWord = Math.max(120, dur/words.length);
  let wi=0;
  const tick=()=>{
    if(wi>=words.length)return;
    for(let i=0;i<words.length;i++){const el=document.getElementById(`fs-lw-${i}`);if(!el)continue;el.className='lyric-word '+(i<wi?'done':i===wi?'current':'upcoming');}
    wi++;
  };
  tick();
  const fsi=setInterval(()=>{if(wi>=words.length){clearInterval(fsi);return;}tick();},perWord);
}

// ── Scoring per line ───────────────────────────────────────────────
function scoreLine() {
  if (!analyser) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
  const vol = Math.sqrt(rms/buf.length);
  const sang = vol > 0.018;
  if (sang) {
    sungLines++; combo++; if(combo>maxCombo) maxCombo=combo;
    score = Math.min(100, score + (totalLines>0 ? (10+Math.min(combo,8)*1.5)/totalLines*10 : 0));
    flashFeedback('✅');
  } else {
    missedLines++; combo=0; flashFeedback('');
  }
  updateStatsUI();
}

function flashFeedback(emoji) {
  if (!emoji) return;
  const el = document.createElement('div');
  el.className='line-feedback'; el.textContent=emoji;
  el.style.cssText='position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:999;font-size:2.5rem;pointer-events:none';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 900);
}

function updateStatsUI() {
  const pct = Math.round(score);
  document.getElementById('score-fill').style.width = pct+'%';
  document.getElementById('score-val').textContent = pct;
  const fsSF = document.getElementById('fs-score-fill');
  if(fsSF) fsSF.style.width = pct+'%';
  const acc = totalLines>0 ? Math.min(100,Math.round(sungLines/totalLines*100)) : 0;
  document.getElementById('stat-score').textContent = pct;
  document.getElementById('stat-acc').textContent = acc+'%';
  document.getElementById('stat-lines').textContent = sungLines;
  document.getElementById('stat-combo').textContent = maxCombo;
}

// ── Sync offset ────────────────────────────────────────────────────
function adjustOffset(delta) {
  syncOffset = Math.round((syncOffset + delta)*10)/10;
  document.getElementById('offset-val').textContent = (syncOffset>=0?'+':'')+syncOffset.toFixed(1)+'s';
}

// ── Mic ────────────────────────────────────────────────────────────
async function toggleMic() {
  if (micActive) { stopMic(); return; }
  try {
    const micSelect = document.getElementById('mic-select');
    const deviceId = micSelect ? micSelect.value : null;
    const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) { constraints.deviceId = { exact: deviceId }; }
    
    micStream = await navigator.mediaDevices.getUserMedia({audio: constraints});
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    analyser = audioCtx.createAnalyser(); analyser.fftSize=2048;
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
    micActive = true;
    document.getElementById('mic-btn').textContent='🔴 Microfone Ligado';
    document.getElementById('mic-btn').classList.add('on');
    setTimeout(()=>{ if(ytPlayer && ytPlayer.playVideo) try{ytPlayer.playVideo();}catch(e){} },350);
    startPitchLoop();
  } catch(e) { alert('Erro ao acessar microfone: '+e.message); }
}
function stopMic() {
  micActive=false;
  if(micStream) micStream.getTracks().forEach(t=>t.stop());
  if(audioCtx) audioCtx.close();
  document.getElementById('mic-btn').textContent='🎤 Ativar Microfone';
  document.getElementById('mic-btn').classList.remove('on');
}
function startPitchLoop() {
  const buf=new Float32Array(analyser.fftSize);
  const fbuf=new Uint8Array(analyser.frequencyBinCount);
  function loop() {
    if(!micActive) return;
    analyser.getFloatTimeDomainData(buf);
    analyser.getByteFrequencyData(fbuf);
    renderPitchBars(fbuf, autoCorrelate(buf,audioCtx.sampleRate));
    requestAnimationFrame(loop);
  }
  loop();
}
function renderPitchBars(fbuf, pitch) {
  const noteNameEl = document.getElementById('note-name');
  const noteName = freqToNote(pitch);
  noteNameEl.textContent = noteName || '--';
  
  const active = pitch > 0;
  const midi = active ? freqToMidi(pitch) : null;
  
  pitchHistory.push({
    time: Date.now(),
    midi: midi,
    active: active
  });
  
  if (pitchHistory.length > MAX_HISTORY_POINTS) {
    pitchHistory.shift();
  }
  
  if (active && midi && lyrics) {
    const t = ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    
    for (let line of lyrics) {
      if (!line.notes) continue;
      for (let note of line.notes) {
        const overlap = t >= note.time && t <= (note.time + note.duration);
        if (overlap) {
          const diff = Math.abs(midi - note.note);
          if (diff <= 1.5) { // Match!
            note.matched = true;
            
            const canvasEl = document.getElementById('pitch-chart-canvas');
            if (canvasEl) {
              const W = canvasEl.width;
              const H = canvasEl.height;
              const X_present = W * 0.20;
              const Y_user = getNoteY(midi, H);
              createParticles(X_present, Y_user, 'var(--c2)');
            }
            
            combo++;
            if (combo > maxCombo) maxCombo = combo;
            
            score = Math.min(100, score + (totalLines > 0 ? (0.2 + Math.min(combo, 12) * 0.05) / totalLines : 0.02));
            updateStatsUI();
          }
        }
      }
    }
  }
}
function autoCorrelate(buf,sr){
  let SIZE=buf.length,rms=0;
  for(let i=0;i<SIZE;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/SIZE);
  if(rms<0.01) return -1;
  let r1=0,r2=SIZE-1;
  for(let i=0;i<SIZE/2;i++) if(Math.abs(buf[i])<0.2){r1=i;break;}
  for(let i=1;i<SIZE/2;i++) if(Math.abs(buf[SIZE-i])<0.2){r2=SIZE-i;break;}
  buf=buf.slice(r1,r2); SIZE=buf.length;
  const c=new Array(SIZE).fill(0);
  for(let i=0;i<SIZE;i++) for(let j=0;j<SIZE-i;j++) c[i]+=buf[j]*buf[j+i];
  let d=0; while(c[d]>c[d+1]) d++;
  let mv=-1,mp=-1;
  for(let i=d;i<SIZE;i++) if(c[i]>mv){mv=c[i];mp=i;}
  if(mp<1) return -1;
  const x1=c[mp-1],x2=c[mp],x3=c[mp+1],a=(x1+x3-2*x2)/2,b=(x3-x1)/2;
  return sr/(a?mp-b/(2*a):mp);
}
const NOTES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function freqToMidi(f) {
  if (f <= 0 || f > 2000) return null;
  return Math.round(12 * Math.log2(f / 440)) + 57;
}
function freqToNote(f) {
  const midi = freqToMidi(f);
  if (!midi) return null;
  return NOTES[midi % 12] + (Math.floor(midi / 12) - 1);
}

function generateProceduralNotes(lcs) {
  if (!lcs || !lcs.length) return null;
  for (let i = 0; i < lcs.length; i++) {
    const line = lcs[i];
    const nextLine = lcs[i + 1];
    const duration = nextLine ? (nextLine.time - line.time) : 6.0;
    const words = line.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const maxWordDuration = 1.8;
    const wordDuration = Math.min(maxWordDuration, duration / words.length);
    
    line.notes = [];
    let currentWordTime = line.time;
    for (let j = 0; j < words.length; j++) {
      const baseNote = 60; // C4 base
      const pentatonicScale = [0, 2, 4, 7, 9, 12, 14, 16, 19]; // Pentatonic major intervals
      const scaleIndex = (i * 2 + j) % pentatonicScale.length;
      const note = baseNote + pentatonicScale[scaleIndex];
      line.notes.push({
        word: words[j],
        time: currentWordTime,
        duration: wordDuration * 0.92,
        note: note,
        matched: false
      });
      currentWordTime += wordDuration;
    }
  }
  return lcs;
}

function startChartAnimation() {
  if (chartAnimId) cancelAnimationFrame(chartAnimId);
  canvas = document.getElementById('pitch-chart-canvas');
  if (canvas) {
    ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  chartAnimId = requestAnimationFrame(animateChart);
}

function stopChartAnimation() {
  if (chartAnimId) {
    cancelAnimationFrame(chartAnimId);
    chartAnimId = null;
  }
}

function clearPitchHistory() {
  pitchHistory = [];
  particles = [];
}

function createParticles(x, y, color) {
  const count = 3;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x,
      y: y,
      vx: -40 - Math.random() * 60,
      vy: (Math.random() - 0.5) * 50,
      size: 2.5 + Math.random() * 3.5,
      color: color || 'var(--c2)',
      alpha: 1.0,
      life: 0.6 + Math.random() * 0.4
    });
  }
}

function getNoteY(midi, height) {
  const padding = 15;
  const pct = (midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN);
  const clamped = Math.max(0, Math.min(1, pct));
  return padding + (1 - clamped) * (height - 2 * padding);
}

function animateChart() {
  if (!canvas) {
    canvas = document.getElementById('pitch-chart-canvas');
    if (canvas) ctx = canvas.getContext('2d');
  }
  if (!canvas || !ctx) {
    chartAnimId = requestAnimationFrame(animateChart);
    return;
  }
  
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  
  // 1. Draw Grid Lines
  const staveNotes = [
    { midi: 55, name: 'G3' },
    { midi: 62, name: 'D4' },
    { midi: 69, name: 'A4' },
    { midi: 76, name: 'E5' }
  ];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '9px monospace';
  
  for (let note of staveNotes) {
    const y = getNoteY(note.midi, H);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillText(note.name, 6, y - 3);
  }
  ctx.setLineDash([]); // Reset dashed lines
  
  // Current time line marker (Target threshold)
  const X_present = W * 0.20;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(X_present, 0);
  ctx.lineTo(X_present, H);
  ctx.stroke();
  
  // 2. Draw Target Melody Capsules
  const curTime = ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
  const pixels_per_second = W / 5.5; // viewport duration width is 5.5s
  
  if (lyrics && lyrics.length) {
    ctx.textAlign = 'left';
    ctx.font = '600 10.5px Outfit, Inter, sans-serif';
    
    for (let line of lyrics) {
      if (!line.notes) continue;
      for (let note of line.notes) {
        const x = X_present + (note.time - curTime) * pixels_per_second;
        const w = note.duration * pixels_per_second;
        
        if (x + w >= 0 && x <= W) {
          const y = getNoteY(note.note, H);
          
          // Outer glow for matched items
          if (note.matched) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'var(--c2)';
          }
          
          ctx.fillStyle = note.matched ? 'rgba(123, 97, 255, 0.38)' : 'rgba(255, 255, 255, 0.08)';
          ctx.strokeStyle = note.matched ? 'var(--c2)' : 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = note.matched ? 2 : 1;
          
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, y - 6, w, 12, 6);
          } else {
            ctx.rect(x, y - 6, w, 12);
          }
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0; // Reset glow
          
          ctx.fillStyle = note.matched ? '#fff' : 'rgba(255, 255, 255, 0.75)';
          ctx.fillText(note.word, x + 5, y + 3.5);
        }
      }
    }
  }
  
  // 3. Draw Voice pitch trail ribbon
  if (pitchHistory.length > 1) {
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'var(--c2)';
    ctx.strokeStyle = 'var(--c2)';
    
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < pitchHistory.length; i++) {
      const pt = pitchHistory[i];
      const age_seconds = (Date.now() - pt.time) / 1000;
      const x = X_present - age_seconds * pixels_per_second;
      
      if (x < 0) continue;
      
      if (pt.active && pt.midi) {
        const y = getNoteY(pt.midi, H);
        if (!drawing) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        if (drawing) {
          ctx.stroke();
          drawing = false;
        }
      }
    }
    if (drawing) ctx.stroke();
    ctx.shadowBlur = 0; // Reset glow
  }
  
  // 4. Update and Draw Particles
  if (particles.length > 0) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      p.alpha -= 0.016 / p.life;
      
      if (p.alpha <= 0) {
        particles.splice(i, 1);
        continue;
      }
      
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }
  
  // 5. Draw Voice Cursor Indicator
  if (pitchHistory.length > 0) {
    const latest = pitchHistory[pitchHistory.length - 1];
    if (latest.active && latest.midi) {
      const y = getNoteY(latest.midi, H);
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#fff';
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(X_present, y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  
  chartAnimId = requestAnimationFrame(animateChart);
}

// ── Stop / Result ──────────────────────────────────────────────────
function stopKaraoke() {
  if(syncInterval) clearInterval(syncInterval);
  if(wordInterval) clearInterval(wordInterval);
  stopMic();
  stopChartAnimation();
  
  if(ytPlayer) try{ytPlayer.stopVideo();}catch(e){}
  showResult();
}

function exitPlayerFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(()=>{});
  }
}
// ── Playlist Queue ────────────────────────────────────────────────
let playlistQueue = [];
let nextSongTimeout = null;
let nextSongCountdown = 8;
let nextSongInterval = null;

let isRemoteMode = false;
let weAreHost = false;
let hostSessionId = sessionStorage.getItem('hostSessionId');
if (!hostSessionId) {
  hostSessionId = 'host_' + Math.random().toString(36).substring(2, 15);
  sessionStorage.setItem('hostSessionId', hostSessionId);
}
let hostPingInterval = null;

function startHostPing() {
  if (hostPingInterval) clearInterval(hostPingInterval);
  hostPingInterval = setInterval(async () => {
    if (!weAreHost) {
      clearInterval(hostPingInterval);
      hostPingInterval = null;
      return;
    }
    try {
      await fetch('/api/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', sessionId: hostSessionId })
      });
    } catch (e) {}
  }, 3000);
}

async function toggleRemoteMode() {
  const btn = document.getElementById('remote-toggle-btn');
  const micWrap = document.getElementById('mic-wrap');
  const actionWrap = document.getElementById('action-btns-wrap');
  
  if (isRemoteMode) {
    try {
      const r = await fetch('/api/host', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim', sessionId: hostSessionId }) });
      if (r.status === 403) { showErr('⚠️ Já existe um Telão ativo na rede!'); return; }
    } catch(e) {}
    
    weAreHost = true;
    isRemoteMode = false;
    btn.textContent = '📺 Modo: Telão (Clique para liberar Controle)';
    btn.style.background = 'transparent';
    btn.style.color = 'var(--c2)';
    if (micWrap) micWrap.style.display = 'block';
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.style.display = 'flex';
    startHostPing();
  } else {
    try { await fetch('/api/host', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release', sessionId: hostSessionId }) }); } catch(e) {}
    
    weAreHost = false;
    isRemoteMode = true;
    btn.textContent = '📱 Modo: Controle Remoto (Clique para assumir Telão)';
    btn.style.background = 'var(--c2)';
    btn.style.color = '#fff';
    if (micWrap) micWrap.style.display = 'none';
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.style.display = 'none';
    if (hostPingInterval) {
      clearInterval(hostPingInterval);
      hostPingInterval = null;
    }
  }
}

// ── QR Code ────────────────────────────────────────────────────────
let qrcodeInstance = null;
function showQrModal() {
  document.getElementById('qr-modal-overlay').style.display = 'flex';
  const qrContainer = document.getElementById('qrcode-container');
  
  // Calculate host dynamically: resolve localhost/127.0.0.1 to server's local network IP
  let host = window.location.host;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    if (serverInfo && serverInfo.localIp && serverInfo.localIp !== 'localhost') {
      host = `${serverInfo.localIp}:${serverInfo.port || window.location.port || '8765'}`;
    }
  }
  const url = window.location.protocol + '//' + host + '/?remote=true';

  // Update link text
  const linkText = document.getElementById('qr-link-text');
  if (linkText) {
    linkText.href = url;
    linkText.textContent = url;
  }
  
  if (!qrcodeInstance) {
    qrcodeInstance = new QRCode(qrContainer, {
      text: url,
      width: 200,
      height: 200,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
  } else {
    qrcodeInstance.clear();
    qrcodeInstance.makeCode(url);
  }
}
function closeQrModal() {
  document.getElementById('qr-modal-overlay').style.display = 'none';
}

// ── Mirroring / Casting ───────────────────────────────────────────
function showMirrorModal() {
  document.getElementById('mirror-modal-overlay').style.display = 'flex';
  switchInstructions('android'); // Default to Android on open
}
function closeMirrorModal() {
  document.getElementById('mirror-modal-overlay').style.display = 'none';
}
function switchInstructions(device) {
  ['android', 'ios', 'pc'].forEach(d => {
    const content = document.getElementById('inst-' + d);
    const btn = document.getElementById('btn-inst-' + d);
    if (!content || !btn) return;
    if (d === device) {
      content.style.display = 'block';
      btn.style.color = 'var(--text)';
      btn.style.borderBottom = '2px solid var(--c1)';
      btn.style.background = 'rgba(255,255,255,0.08)';
    } else {
      content.style.display = 'none';
      btn.style.color = 'var(--sub)';
      btn.style.borderBottom = 'none';
      btn.style.background = 'rgba(255,255,255,0.03)';
    }
  });
}
function triggerPresentationCast() {
  if ('PresentationRequest' in window) {
    // We try to present the Telão URL directly
    const targetUrl = window.location.origin + window.location.pathname;
    const request = new PresentationRequest([targetUrl]);
    
    if (navigator.presentation) {
      navigator.presentation.defaultRequest = request;
    }
    
    request.start()
      .then(connection => {
        console.log('Conectado à TV:', connection.url);
        closeMirrorModal();
      })
      .catch(err => {
        console.log('Apresentação cancelada ou falhou:', err);
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          alert('Não foi possível conectar automaticamente. Use o método 2 (Espelhamento de Tela) do seu aparelho!');
        }
      });
  } else {
    alert('Seu navegador não suporta a transmissão direta por aqui. Use a opção 2 para espelhar a tela do seu celular/PC!');
  }
}

async function syncQueue() {
  try {
    const r = await fetch('/api/queue');
    if (r.ok) {
      const data = await r.json();
      playlistQueue = data.queue;
      renderQueue();
      
      const btn = document.getElementById('remote-toggle-btn');
      
      // Auto-reclaim host if this session matches active host on server
      if (data.hostActive && data.activeHostSessionId === hostSessionId && !weAreHost) {
        weAreHost = true;
        isRemoteMode = false;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '📺 Modo: Telão (Clique para liberar Controle)';
        btn.style.background = 'transparent';
        btn.style.color = 'var(--c2)';
        const micWrap = document.getElementById('mic-wrap');
        if (micWrap) micWrap.style.display = 'block';
        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.style.display = 'flex';
        startHostPing();
      }

      if (data.hostActive && !weAreHost) {
        // Force remote UI only once
        if (!isRemoteMode) {
          isRemoteMode = true;
          const micWrap = document.getElementById('mic-wrap');
          btn.style.background = 'var(--c2)';
          btn.style.color = '#fff';
          if (micWrap) micWrap.style.display = 'none';
          const startBtn = document.getElementById('start-btn');
          if (startBtn) startBtn.style.display = 'none';
        }
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.textContent = '📱 Controle Remoto (Telão já em uso)';
      } else if (!data.hostActive && isRemoteMode) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '📱 Modo: Controle Remoto (Clique para assumir Telão)';
      }
      
      // Synchronize Tournament State
      if (data.tournament && data.tournament.active) {
        const wasActive = tourActive;
        tourActive = true;
        tourMode = data.tournament.mode;
        tourTotalRounds = data.tournament.totalRounds;
        tourCurrentRound = data.tournament.currentRound;
        tourCurrentPlayerIdx = data.tournament.currentPlayerIdx;
        
        if (weAreHost) {
          // Telão: Update only songs from server, keep local scores (calculating on TV)
          data.tournament.players.forEach((sp, idx) => {
            if (tourPlayers[idx]) {
              tourPlayers[idx].songs = sp.songs || [];
            } else {
              tourPlayers[idx] = {
                name: sp.name,
                scores: sp.scores || [],
                totalScore: sp.totalScore || 0,
                songs: sp.songs || []
              };
            }
          });
          
          updateTournamentHeader();
          
          if (!wasActive) {
            // Started remotely! Switch TV to tournament view
            document.getElementById('setup-card').classList.add('hidden');
            document.getElementById('karaoke-card').classList.remove('hidden');
            loadTournamentTurn();
          }
          
          // If we are showing the waiting screen, check if the song was just populated
          const waitingScreen = document.getElementById('tour-waiting-screen');
          if (waitingScreen && waitingScreen.style.display === 'block') {
            const activePlayer = tourPlayers[tourCurrentPlayerIdx];
            if (activePlayer && activePlayer.songs && activePlayer.songs[tourCurrentRound - 1]) {
              loadWaitingTournamentSong();
            }
          }
        } else {
          // Remote Control cellphone: Full sync from server
          tourPlayers = data.tournament.players;
          document.getElementById('tour-setup-config').style.display = 'none';
          document.getElementById('tour-remote-panel').style.display = 'block';
          
          // Hide singer name input on remote during tournament since singer is predefined
          const inpSinger = document.getElementById('inp-singer');
          if (inpSinger) inpSinger.style.display = 'none';
          
          renderTournamentRemotePanel();
        }
      } else {
        // Tournament NOT active on server
        if (tourActive) {
          tourActive = false;
          resetApp();
        }
        
        // Sync draft players list and setup configs if tournament is NOT active
        if (data.tournament) {
          tourMode = data.tournament.mode;
          tourTotalRounds = data.tournament.totalRounds;
          
          const roundsSelect = document.getElementById('tour-rounds');
          if (roundsSelect && roundsSelect.value !== String(tourTotalRounds)) {
            roundsSelect.value = tourTotalRounds;
          }
          
          const btnSolo = document.getElementById('btn-tour-solo');
          const btnGroup = document.getElementById('btn-tour-group');
          const configGroup = document.getElementById('tour-group-config');
          if (btnSolo && btnGroup && configGroup) {
            if (tourMode === 'solo') {
              btnSolo.className = 'btn btn-primary';
              btnGroup.className = 'btn btn-ghost';
              configGroup.style.display = 'none';
            } else {
              btnSolo.className = 'btn btn-ghost';
              btnGroup.className = 'btn btn-primary';
              configGroup.style.display = 'block';
            }
          }
          
          // Only pull players if the user is not actively typing in the input to prevent focus issues
          if (document.activeElement !== document.getElementById('inp-tour-player')) {
            tourPlayers = data.tournament.setupPlayers || [];
            renderTournamentPlayers();
          }
        }
        
        if (!weAreHost) {
          document.getElementById('tour-setup-config').style.display = 'block';
          document.getElementById('tour-remote-panel').style.display = 'none';
        }
      }
      
      // Dynamic Action Buttons Layout (handles PC and mobile, normal and tournament select modes)
      const actionWrap = document.getElementById('action-btns-wrap');
      if (actionWrap) {
        if (selectingForPlayerIdx !== null) {
          const playerName = tourPlayers[selectingForPlayerIdx] ? tourPlayers[selectingForPlayerIdx].name : '';
          if (!actionWrap.querySelector('[style*="background:#4caf50"]') || (actionWrap.innerText && !actionWrap.innerText.includes(playerName))) {
            actionWrap.style.flexDirection = 'column';
            actionWrap.innerHTML = `
              <button class="btn btn-primary" id="add-queue-btn" onclick="addToQueue()" style="width:100%;padding:14px;background:#4caf50;font-weight:bold;box-shadow:0 4px 15px rgba(76,175,80,0.3);" title="Confirmar escolha de música para o participante da disputa">✅ Confirmar escolha para: ${playerName}</button>
            `;
          }
        } else {
          if (weAreHost) {
            if (!document.getElementById('start-btn')) {
              actionWrap.style.flexDirection = 'row';
              actionWrap.innerHTML = `
                <button class="btn btn-primary" id="start-btn" onclick="startKaraoke()" style="flex:2">🎵 Iniciar Karaokê</button>
                <button class="btn btn-ghost" id="add-queue-btn" onclick="addToQueue()" style="flex:1;padding:12px 10px;" title="Adicionar música à fila de reprodução">➕ Fila</button>
              `;
            }
          } else {
            // Remote Cellphone
            if (!document.getElementById('inp-singer')) {
              actionWrap.style.flexDirection = 'column';
              actionWrap.innerHTML = `
                <input id="inp-singer" placeholder="👤 Seu nome (quem vai cantar)" list="singers-list" style="width:100%;padding:10px 14px;background:rgba(0,0,0,0.35);color:var(--text);border:1px solid var(--c2);border-radius:10px;font-size:0.9rem;outline:none;box-sizing:border-box;"/>
                <button class="btn btn-primary" id="add-queue-btn" onclick="addToQueue()" style="width:100%;padding:14px;" title="Adicionar música à fila global">➕ Enviar para a TV</button>
              `;
            }
            
            const inpSinger = document.getElementById('inp-singer');
            const btnAdd = document.getElementById('add-queue-btn');
            
            if (tourActive) {
              if (inpSinger && inpSinger.style.display !== 'none') inpSinger.style.display = 'none';
              if (btnAdd && btnAdd.textContent !== `➕ Escolher pela aba "Disputa"`) {
                btnAdd.textContent = `➕ Escolher pela aba "Disputa"`;
                btnAdd.disabled = true;
                btnAdd.style.opacity = '0.5';
              }
            } else {
              if (inpSinger && inpSinger.style.display !== 'block') inpSinger.style.display = 'block';
              if (btnAdd && btnAdd.textContent !== '➕ Enviar para a TV') {
                btnAdd.textContent = '➕ Enviar para a TV';
                btnAdd.disabled = false;
                btnAdd.style.opacity = '1';
              }
            }
          }
        }
      }
    }
  } catch(e) {}
}
setInterval(syncQueue, 2000);

async function addToQueue() {
  const artist = document.getElementById('inp-artist').value.trim();
  const track  = document.getElementById('inp-track').value.trim();
  const url    = document.getElementById('inp-url').value.trim();
  if (!url) { showErr('⚠️ Busque e selecione uma música no YouTube primeiro!'); return; }
  const vid = extractVideoId(url);
  if (!vid) { showErr('⚠️ URL inválida. Copie a URL completa do YouTube.'); return; }
  
  if (selectingForPlayerIdx !== null && selectingForRoundIdx !== null) {
    // Adding to a specific tournament slot
    await fetch('/api/tournament/song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerIdx: selectingForPlayerIdx,
        roundIdx: selectingForRoundIdx,
        song: { artist: artist || '?', track: track || '?', url }
      })
    });
    
    // Clear selection state
    selectingForPlayerIdx = null;
    selectingForRoundIdx = null;
    const banner = document.getElementById('tour-selecting-banner');
    if (banner) banner.style.display = 'none';
    
    await syncQueue();
    switchTab('disputa');
    
    document.getElementById('inp-artist').value = '';
    document.getElementById('inp-track').value = '';
    document.getElementById('inp-url').value = '';
    hideErr();
    return;
  }
  
// Normal queue behavior
  const singerEl = document.getElementById('inp-singer');
  const roundsEl = document.getElementById('inp-rounds');
  const singer = singerEl ? singerEl.value.trim() : '';
  const rounds = roundsEl ? roundsEl.value.trim() : '1';
  
  if (!singer) { showErr('⚠️ Informe o Nome do Participante!'); return; }
  
  saveSingerName(singer);
  
  await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artist: artist || '?', track: track || '?', url, singer: singer || '', rounds: rounds || '1' })
  });
  
  await syncQueue();
  switchTab('lista');
  
  document.getElementById('inp-artist').value = '';
  document.getElementById('inp-track').value = '';
  document.getElementById('inp-url').value = '';
  if (singerEl) singerEl.value = '';
  hideErr();
}

async function removeFromQueue(id) {
  await fetch(`/api/queue?id=${id}`, { method: 'DELETE' });
  await syncQueue();
}

function renderQueue() {
  const wrap = document.getElementById('queue-wrap');
  const count = document.getElementById('queue-count');
  count.textContent = playlistQueue.length;
  
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    if (playlistQueue.length > 0) {
      startBtn.style.display = 'block';
    } else {
      startBtn.style.display = 'none';
    }
  }
  
  if (!playlistQueue.length) {
    wrap.innerHTML = '<div class="queue-empty-msg">A fila está vazia. Adicione músicas para tocar em sequência!</div>';
    return;
  }
  
  wrap.innerHTML = playlistQueue.map((e) => `
    <div class="queue-item">
      <div class="queue-info">
        <div class="queue-title">${e.track}</div>
        <div class="queue-artist">${e.artist}</div>
        ${e.singer ? `<div style="font-size:.72rem;color:var(--c2);font-weight:700;margin-top:2px">👤 ${e.singer} (Rodadas: ${e.rounds || '1'})</div>` : ''}
      </div>
      <div class="queue-actions">
        <button class="queue-remove" onclick="removeFromQueue(${e.id})" title="Remover da fila">✕</button>
      </div>
    </div>
  `).join('');
}

// ── YouTube Search ────────────────────────────────────────────────
async function searchYouTube() {
  const artist = document.getElementById('inp-artist').value.trim();
  const track  = document.getElementById('inp-track').value.trim();
  let q = (artist && track) ? `${artist} ${track}` : (artist || track);
  
  if (!q) {
    const urlVal = document.getElementById('inp-url').value.trim();
    if (urlVal && !urlVal.includes('youtube.com') && !urlVal.includes('youtu.be')) {
      q = urlVal;
    }
  }
  
  if (!q) {
    showErr('⚠️ Preencha o Artista e Música ou digite um termo de busca no campo de URL!');
    return;
  }
  
  hideErr();
  const searchBtn = document.getElementById('search-btn');
  const originalText = searchBtn.textContent;
  searchBtn.textContent = '⏳ Buscando...';
  searchBtn.disabled = true;
  
  try {
    const res = await fetch(`/api/search-yt?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    
    if (data.error) {
      showErr(`❌ Erro na busca: ${data.error}`);
      return;
    }
    
    renderSearchResults(data.videos);
  } catch (e) {
    showErr(`❌ Falha de rede ao buscar: ${e.message}`);
  } finally {
    searchBtn.textContent = originalText;
    searchBtn.disabled = false;
  }
}

function renderSearchResults(videos) {
  const panel = document.getElementById('search-results-panel');
  const list = document.getElementById('search-results-list');
  
  if (!videos || !videos.length) {
    list.innerHTML = '<div style="color:var(--dim);font-size:.8rem;text-align:center;padding:10px 0;">Nenhum vídeo encontrado. Tente ajustar os termos.</div>';
    panel.classList.remove('hidden');
    return;
  }
  
  list.innerHTML = videos.map(v => `
    <div class="search-result-item" onclick="selectSearchResult('${v.videoId}', this)">
      <div class="search-result-thumb-container">
        <img class="search-result-thumb" src="${v.thumb || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`}" alt="thumbnail"/>
        ${v.duration ? `<span class="search-result-duration">${v.duration}</span>` : ''}
      </div>
      <div class="search-result-info">
        <div class="search-result-title" title="${v.title}">${v.title}</div>
        <div class="search-result-channel">${v.channel || 'YouTube'}</div>
      </div>
    </div>
  `).join('');
  
  panel.classList.remove('hidden');
}

function selectSearchResult(videoId, element) {
  document.getElementById('inp-url').value = `https://www.youtube.com/watch?v=${videoId}`;
  
  // Auto-fill artist and track from YouTube title if they are empty
  const titleEl = element.querySelector('.search-result-title');
  if (titleEl) {
    const titleText = titleEl.getAttribute('title') || titleEl.textContent;
    const inpArtist = document.getElementById('inp-artist');
    const inpTrack = document.getElementById('inp-track');
    
    if (!inpArtist.value || !inpTrack.value) {
      let cleanTitle = titleText.replace(/karaok[eê]/ig, '').replace(/[\(\)\[\]]/g, '').trim();
      let parts = cleanTitle.split('-');
      if (parts.length >= 2) {
        inpArtist.value = parts[0].trim();
        inpTrack.value = parts.slice(1).join('-').trim();
      } else {
        inpTrack.value = cleanTitle;
      }
    }
  }
  
  const items = document.querySelectorAll('.search-result-item');
  items.forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  
  // Show the confirm button when a song is selected
  const confirmBtn = document.getElementById('confirm-song-btn');
  if (confirmBtn) confirmBtn.style.display = 'block';
}

function confirmSongSelection() {
  addToQueue();
  // Hide the confirm button after confirming
  const confirmBtn = document.getElementById('confirm-song-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  
  // Clear search results to signify completion
  hideSearchResults();
}

function hideSearchResults() {
  document.getElementById('search-results-panel').classList.add('hidden');
}

function updateNextSongBanner() {
  const banner = document.getElementById('next-song-banner');
  const title = document.getElementById('next-song-title');
  if (playlistQueue.length > 0) {
    banner.style.display = 'flex';
    title.textContent = `${playlistQueue[0].artist} - ${playlistQueue[0].track}`;
  } else {
    banner.style.display = 'none';
  }
}

async function playNextInQueue() {
  cancelNextSongTimer();
  
  // Solicita tela cheia imediatamente
  const playerWrap = document.getElementById('player-wrap');
  if (playerWrap && playerWrap.requestFullscreen && !document.fullscreenElement) {
    playerWrap.requestFullscreen().catch(e => console.log('Fullscreen negado:', e));
  }
  
  document.getElementById('result-overlay').classList.remove('show');
  
  let nextSong = null;
  try {
    const r = await fetch('/api/queue/pop', { method: 'POST' });
    nextSong = await r.json();
  } catch(e) {
    console.error("Queue pop error:", e);
  }
  
  if (!nextSong) {
    resetApp();
    return;
  }
  
  await syncQueue();
  
  document.getElementById('inp-artist').value = nextSong.artist || '';
  document.getElementById('inp-track').value = nextSong.track || '';
  document.getElementById('inp-url').value = nextSong.url || '';
  const inpSinger = document.getElementById('inp-singer');
  if (inpSinger) inpSinger.value = nextSong.singer || '';
  
  startKaraoke();
}

function cancelNextSongTimer() {
  if (nextSongInterval) {
    clearInterval(nextSongInterval);
    nextSongInterval = null;
  }
}

function showResult() {
  const s = Math.round(score);
  document.getElementById('res-score').textContent = s;
  let rank,stars,emoji;
  if(s>=90){rank='🏆 Lenda!';stars='⭐⭐⭐⭐⭐';emoji='🏆';}
  else if(s>=75){rank='🎤 Estrela!';stars='⭐⭐⭐⭐';emoji='🎤';}
  else if(s>=55){rank='🎵 Promissor!';stars='⭐⭐⭐';emoji='🎵';}
  else if(s>=35){rank='😅 Praticando...';stars='⭐⭐';emoji='😅';}
  else{rank='🎯 Tente de novo!';stars='⭐';emoji='🎯';}
  document.getElementById('res-emoji').textContent=emoji;
  document.getElementById('res-stars').textContent=stars;
  document.getElementById('res-rank').textContent=rank;
  document.getElementById('res-sub').innerHTML=`Linhas cantadas: <b>${sungLines}</b> | Combo máx: <b>${maxCombo}</b> | Erros: <b>${missedLines}</b>`;
  
  // update history score
  const h=getHistory(); if(h.length){h[0].score=s;localStorage.setItem('kk-history',JSON.stringify(h));}
  
  // Tournament Integration
  const tourSection = document.getElementById('tour-result-section');
  const btnContainer = document.querySelector('.result-btns');
  
  if (tourActive) {
    const activePlayer = tourPlayers[tourCurrentPlayerIdx];
    if (activePlayer) {
      activePlayer.scores.push(s);
      activePlayer.totalScore = activePlayer.scores.reduce((a, b) => a + b, 0);
    }
    
    tourSection.style.display = 'block';
    renderLeaderboard();
    
    // Custom buttons for tournament progression
    let nextTurnText = '';
    if (tourMode === 'solo') {
      nextTurnText = tourCurrentRound < tourTotalRounds ? '▶️ Próxima Rodada' : '🏁 Ver Pódio Final';
    } else {
      const nextIdx = (tourCurrentPlayerIdx + 1) % tourPlayers.length;
      const isLastTurn = tourCurrentRound >= tourTotalRounds && nextIdx === 0;
      nextTurnText = isLastTurn ? '🏁 Ver Pódio Final' : `▶️ Próxima Vez (${tourPlayers[nextIdx].name})`;
    }
    
    btnContainer.innerHTML = `
      <button class="btn btn-primary" onclick="nextTournamentTurn()" style="flex:1;">${nextTurnText}</button>
      <button class="btn btn-danger" onclick="exitTournament()" style="flex:100%; margin-top:10px;">⏹ Cancelar Torneio</button>
    `;
  } else {
    tourSection.style.display = 'none';
    
    // Custom buttons for queue mode
    if (playlistQueue.length > 0) {
      nextSongCountdown = 8;
      btnContainer.innerHTML = `
        <button class="btn btn-ghost" onclick="cancelNextSongTimer(); playAgain()">🔁 Repetir Esta</button>
        <button class="btn btn-primary" id="next-song-btn" onclick="playNextInQueue()">▶️ Próxima (${nextSongCountdown}s)</button>
        <button class="btn btn-danger" onclick="cancelNextSongTimer(); resetApp()" style="flex:100%;margin-top:10px;">⏹ Parar Fila</button>
      `;
      
      nextSongInterval = setInterval(() => {
        nextSongCountdown--;
        const btn = document.getElementById('next-song-btn');
        if (btn) btn.textContent = `▶️ Próxima (${nextSongCountdown}s)`;
        if (nextSongCountdown <= 0) {
          clearInterval(nextSongInterval);
          playNextInQueue();
        }
      }, 1000);
    } else {
      btnContainer.innerHTML = `
        <button class="btn btn-ghost" onclick="playAgain()">🔁 Cantar de novo</button>
        <button class="btn btn-primary" onclick="resetApp()">🎵 Nova música</button>
      `;
    }
  }
  
  document.getElementById('result-overlay').classList.add('show');
}

function resetApp() {
  exitPlayerFullscreen();
  cancelNextSongTimer();
  closeFsOverlay();
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('player-wrap').style.display='none';
  if(ytPlayer){try{ytPlayer.destroy();}catch(e){}ytPlayer=null;}
  document.getElementById('yt-player-div').innerHTML='';
  document.getElementById('karaoke-card').classList.add('hidden');
  document.getElementById('setup-card').classList.remove('hidden');
  document.getElementById('lyrics-stage').innerHTML='<div class="lyric-empty">As letras aparecerão aqui sincronizadas...</div>';
  
  // Clear Fullscreen Lyrics too!
  document.getElementById('fs-prev').textContent='';
  document.getElementById('fs-current').innerHTML='<div class="lyric-empty">As letras aparecerão aqui sincronizadas...</div>';
  document.getElementById('fs-next').textContent='';
  
  score=0;sungLines=0;combo=0;maxCombo=0;missedLines=0;currentLyricIdx=-1;
  document.getElementById('score-fill').style.width='0%';
  document.getElementById('score-val').textContent='0';
  updateStatsUI();
  updateNextSongBanner();
  updateTournamentHeader();
}

function playAgain() {
  cancelNextSongTimer();
  document.getElementById('result-overlay').classList.remove('show');
  score=0;sungLines=0;combo=0;maxCombo=0;missedLines=0;currentLyricIdx=-1;
  syncOffset=0; document.getElementById('offset-val').textContent='0.0s';
  updateStatsUI();
  if(ytPlayer){try{ytPlayer.seekTo(0);ytPlayer.playVideo();}catch(e){}}
  if(lyrics&&lyrics.length) showCountdown(startLyricSync);
}

// ── Fullscreen lyrics ──────────────────────────────────────────────
function openFsOverlay() {
  const fs = document.getElementById('fs-overlay');
  if (!fs) return;
  fs.classList.add('show');
  
  // Real browser fullscreen request
  if (fs.requestFullscreen) {
    fs.requestFullscreen().catch(e=>{});
  } else if (fs.webkitRequestFullscreen) {
    fs.webkitRequestFullscreen();
  } else if (fs.msRequestFullscreen) {
    fs.msRequestFullscreen();
  }
}

function closeFsOverlay() {
  const fs = document.getElementById('fs-overlay');
  if (!fs) return;
  fs.classList.remove('show');
  
  // Real browser exit fullscreen
  if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(e=>{});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

// ── Tournament / Disputa State ─────────────────────────────────────
let tourActive = false;
let tourMode = 'solo'; // 'solo' or 'group'
let tourTotalRounds = 3;
let tourCurrentRound = 1;
let tourPlayers = []; // [{ name: "Alice", scores: [], totalScore: 0 }]
let tourCurrentPlayerIdx = 0;

function uploadTournamentSetup() {
  fetch('/api/tournament/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: tourMode,
      totalRounds: tourTotalRounds,
      setupPlayers: tourPlayers
    })
  });
}

function updateTournamentRounds(val) {
  tourTotalRounds = parseInt(val, 10) || 3;
  uploadTournamentSetup();
}

function setTournamentMode(mode) {
  tourMode = mode;
  const btnSolo = document.getElementById('btn-tour-solo');
  const btnGroup = document.getElementById('btn-tour-group');
  const configGroup = document.getElementById('tour-group-config');
  
  if (mode === 'solo') {
    btnSolo.className = 'btn btn-primary';
    btnGroup.className = 'btn btn-ghost';
    configGroup.style.display = 'none';
  } else {
    btnSolo.className = 'btn btn-ghost';
    btnGroup.className = 'btn btn-primary';
    configGroup.style.display = 'block';
  }
  uploadTournamentSetup();
}

function addTournamentPlayer() {
  const inp = document.getElementById('inp-tour-player');
  const name = inp.value.trim();
  if (!name) return;
  
  if (tourPlayers.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert('Este participante já foi adicionado!');
    return;
  }
  
  tourPlayers.push({ name, scores: [], totalScore: 0 });
  inp.value = '';
  renderTournamentPlayers();
  uploadTournamentSetup();
}

function removeTournamentPlayer(idx) {
  tourPlayers.splice(idx, 1);
  renderTournamentPlayers();
  uploadTournamentSetup();
}

function renderTournamentPlayers() {
  const list = document.getElementById('tour-player-list');
  if (!list) return;
  
  if (tourPlayers.length === 0) {
    list.innerHTML = '<span style="color:var(--dim); font-size:0.8rem; font-style:italic;">Nenhum participante adicionado ainda.</span>';
    return;
  }
  
  list.innerHTML = tourPlayers.map((p, idx) => `
    <div class="tour-player-tag">
      <span>👤 ${p.name}</span>
      <button onclick="removeTournamentPlayer(${idx})" title="Remover">✕</button>
    </div>
  `).join('');
}

function updateTournamentHeader() {
  const banner = document.getElementById('tour-header-banner');
  const txtRound = document.getElementById('tour-banner-round');
  const txtPlayer = document.getElementById('tour-banner-player');
  
  if (!tourActive) {
    banner.style.display = 'none';
    return;
  }
  
  banner.style.display = 'flex';
  txtRound.textContent = `🏆 Rodada ${tourCurrentRound} / ${tourTotalRounds}`;
  
  if (tourMode === 'solo') {
    txtPlayer.textContent = 'Modo Solo';
  } else {
    const player = tourPlayers[tourCurrentPlayerIdx];
    txtPlayer.textContent = `Vez de: ${player ? player.name : '?'}`;
  }
}

function startTournament() {
  // Validate configs
  const roundsSelect = document.getElementById('tour-rounds');
  tourTotalRounds = parseInt(roundsSelect.value, 10) || 3;
  
  if (tourMode === 'group') {
    if (tourPlayers.length < 2) {
      alert('⚠️ Para disputar em grupo, adicione pelo menos 2 participantes!');
      return;
    }
    // Initialize empty scores and empty songs arrays
    tourPlayers.forEach(p => {
      p.scores = [];
      p.totalScore = 0;
      p.songs = Array(tourTotalRounds).fill(null);
    });
  } else {
    // Solo Mode
    tourPlayers = [{ name: 'Jogador Solo', scores: [], totalScore: 0, songs: Array(tourTotalRounds).fill(null) }];
  }
  
  tourActive = true;
  tourCurrentRound = 1;
  tourCurrentPlayerIdx = 0;
  
  // Clear any existing global queue to focus on tournament
  playlistQueue = [];
  renderQueue();
  
  // Sync to server immediately
  fetch('/api/tournament/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: tourMode, totalRounds: tourTotalRounds, players: tourPlayers })
  }).then(() => syncQueue()).then(() => {
    // Load the first turn (checks if song is chosen, otherwise shows waiting screen)
    loadTournamentTurn();
  });
}

function loadTournamentTurn() {
  if (!tourActive) return;
  
  updateTournamentHeader();
  
  const activePlayer = tourPlayers[tourCurrentPlayerIdx];
  if (!activePlayer) return;
  
  const song = activePlayer.songs && activePlayer.songs[tourCurrentRound - 1];
  
  const waitingScreen = document.getElementById('tour-waiting-screen');
  const actionBtns = document.getElementById('action-btns-wrap');
  
  if (song) {
    waitingScreen.style.display = 'none';
    actionBtns.style.display = 'flex';
    
    // Auto-fill TV inputs with the chosen song
    document.getElementById('inp-artist').value = song.artist;
    document.getElementById('inp-track').value = song.track;
    document.getElementById('inp-url').value = song.url;
    
    // Start karaoke!
    startKaraoke();
  } else {
    // Show waiting screen on TV
    document.getElementById('tour-wait-player-name').textContent = activePlayer.name;
    document.getElementById('tour-wait-round-num').textContent = tourCurrentRound;
    
    waitingScreen.style.display = 'block';
    actionBtns.style.display = 'none';
  }
}

function showManualChoiceOnTv() {
  document.getElementById('tour-waiting-screen').style.display = 'none';
  document.getElementById('action-btns-wrap').style.display = 'flex';
}

function loadWaitingTournamentSong() {
  const activePlayer = tourPlayers[tourCurrentPlayerIdx];
  if (!activePlayer) return;
  const song = activePlayer.songs && activePlayer.songs[tourCurrentRound - 1];
  if (!song) return;
  
  document.getElementById('tour-waiting-screen').style.display = 'none';
  document.getElementById('action-btns-wrap').style.display = 'flex';
  
  document.getElementById('inp-artist').value = song.artist;
  document.getElementById('inp-track').value = song.track;
  document.getElementById('inp-url').value = song.url;
  
  startKaraoke();
}

let selectingForPlayerIdx = null;
let selectingForRoundIdx = null;

function renderTournamentRemotePanel() {
  const container = document.getElementById('tour-remote-players-list');
  if (!container) return;
  
  container.innerHTML = tourPlayers.map((p, pIdx) => {
    const roundSlots = Array.from({ length: tourTotalRounds }, (_, rIdx) => {
      const song = p.songs && p.songs[rIdx];
      const isCurrent = (tourCurrentRound === rIdx + 1) && (tourCurrentPlayerIdx === pIdx);
      
      let borderStyle = 'border:1px solid rgba(255,255,255,0.05);';
      let badge = '';
      if (isCurrent) {
        borderStyle = 'border:1px solid var(--c1); background:rgba(123,97,255,0.05);';
        badge = '<span style="font-size:0.6rem; font-weight:800; background:var(--c1); color:#fff; padding:2px 6px; border-radius:4px; margin-left:6px; text-transform:uppercase;">Agora</span>';
      }
      
      if (song) {
        return `
          <div style="padding:10px; border-radius:10px; background:rgba(0,0,0,0.15); ${borderStyle} display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:0.8rem; overflow:hidden; flex:1; padding-right:10px; text-align:left;">
              <div style="color:var(--dim); font-size:0.7rem; font-weight:bold;">RODADA ${rIdx + 1}${badge}</div>
              <div style="font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${song.track}</div>
              <div style="color:var(--sub); font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${song.artist}</div>
            </div>
            <span style="color:#4caf50; font-size:1.1rem; font-weight:bold;">✅</span>
          </div>
        `;
      } else {
        const isSelecting = selectingForPlayerIdx === pIdx && selectingForRoundIdx === rIdx;
        const btnText = isSelecting ? '✍️ Escolhendo...' : '🔍 Escolher Música';
        const btnClass = isSelecting ? 'btn btn-ghost' : 'btn btn-primary';
        
        return `
          <div style="padding:10px; border-radius:10px; background:rgba(0,0,0,0.15); ${borderStyle} display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:0.8rem; text-align:left;">
              <div style="color:var(--dim); font-size:0.7rem; font-weight:bold;">RODADA ${rIdx + 1}${badge}</div>
              <div style="color:var(--sub); font-style:italic;">Sem música definida</div>
            </div>
            <button class="${btnClass}" onclick="selectSongForTournament(${pIdx}, ${rIdx})" style="padding:6px 12px; font-size:0.75rem;">${btnText}</button>
          </div>
        `;
      }
    }).join('');
    
    return `
      <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:12px; text-align:left;">
        <h4 style="font-size:0.95rem; font-weight:700; color:var(--c2); margin-bottom:10px; display:flex; align-items:center; gap:6px;">👤 ${p.name}</h4>
        <div>${roundSlots}</div>
      </div>
    `;
  }).join('');
}

function updateTourBannerSong() {
  if (selectingForPlayerIdx === null) return;
  const artist = document.getElementById('inp-artist').value.trim();
  const track = document.getElementById('inp-track').value.trim();
  const url = document.getElementById('inp-url').value.trim();
  
  const txtSong = document.getElementById('tour-sel-song-name');
  const btnConfirm = document.getElementById('tour-confirm-btn');
  
  if (url) {
    if (txtSong) txtSong.textContent = (artist && track) ? `${artist} - ${track}` : 'Música customizada / URL';
    if (btnConfirm) btnConfirm.style.display = 'inline-block';
  } else {
    if (txtSong) txtSong.textContent = 'Nenhuma música selecionada';
    if (btnConfirm) btnConfirm.style.display = 'none';
  }
}

function selectSongForTournament(playerIdx, roundIdx) {
  selectingForPlayerIdx = playerIdx;
  selectingForRoundIdx = roundIdx;
  
  const banner = document.getElementById('tour-selecting-banner');
  const txtName = document.getElementById('tour-sel-player-name');
  const txtRound = document.getElementById('tour-sel-round-num');
  
  if (banner && tourPlayers[playerIdx]) {
    txtName.textContent = tourPlayers[playerIdx].name;
    txtRound.textContent = roundIdx + 1;
    banner.style.display = 'flex';
  }
  
  updateTourBannerSong();
  switchTab('busca');
}

function cancelTournamentSongSelection() {
  selectingForPlayerIdx = null;
  selectingForRoundIdx = null;
  const banner = document.getElementById('tour-selecting-banner');
  if (banner) banner.style.display = 'none';
}

function renderLeaderboard() {
  const container = document.getElementById('tour-leaderboard');
  if (!container) return;
  
  // Sort players descending by total score
  const sorted = [...tourPlayers].sort((a, b) => b.totalScore - a.totalScore);
  
  container.innerHTML = sorted.map((p, idx) => {
    let rankClass = '';
    let emoji = '🏅';
    if (idx === 0) { rankClass = 'leaderboard-gold'; emoji = '🥇'; }
    else if (idx === 1) { rankClass = 'leaderboard-silver'; emoji = '🥈'; }
    else if (idx === 2) { rankClass = 'leaderboard-bronze'; emoji = '🥉'; }
    
    // Format individual round scores
    const roundDetails = p.scores.map((s, r) => `R${r+1}: <b>${s}</b>`).join(' | ') || 'Ainda não cantou';
    
    return `
      <div class="leaderboard-item ${rankClass}">
        <div class="leaderboard-rank">${emoji}</div>
        <div class="leaderboard-name">
          <div>${p.name}</div>
          <div style="font-size:0.7rem; color:var(--dim); font-weight:normal; margin-top:2px;">${roundDetails}</div>
        </div>
        <div class="leaderboard-score">${Math.round(p.totalScore)} pts</div>
      </div>
    `;
  }).join('');
}

function nextTournamentTurn() {
  // Reset previous player state but keep tournament active
  cancelNextSongTimer();
  document.getElementById('result-overlay').classList.remove('show');
  
  // Destroy old video player
  if (ytPlayer) {
    try { ytPlayer.destroy(); } catch(e){}
    ytPlayer = null;
  }
  document.getElementById('yt-player-div').innerHTML = '';
  document.getElementById('player-wrap').style.display = 'none';
  document.getElementById('karaoke-card').classList.add('hidden');
  document.getElementById('setup-card').classList.remove('hidden');
  
  // Reset inputs
  document.getElementById('inp-artist').value = '';
  document.getElementById('inp-track').value = '';
  document.getElementById('inp-url').value = '';
  
  // Restore action buttons wrap
  document.getElementById('action-btns-wrap').style.display = 'flex';
  
  // Update round/player counters
  if (tourMode === 'solo') {
    tourCurrentRound++;
    if (tourCurrentRound > tourTotalRounds) {
      endTournament();
      return;
    }
  } else {
    tourCurrentPlayerIdx++;
    if (tourCurrentPlayerIdx >= tourPlayers.length) {
      tourCurrentPlayerIdx = 0;
      tourCurrentRound++;
    }
    
    if (tourCurrentRound > tourTotalRounds) {
      endTournament();
      return;
    }
  }
  
  // Sync state to server immediately
  fetch('/api/tournament/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentRound: tourCurrentRound, currentPlayerIdx: tourCurrentPlayerIdx })
  }).then(() => syncQueue()).then(() => {
    loadTournamentTurn();
  });
}

function endTournament() {
  tourActive = false;
  updateTournamentHeader();
  
  // Sort final scores
  const sorted = [...tourPlayers].sort((a, b) => b.totalScore - a.totalScore);
  
  const podiumOverlay = document.getElementById('tour-podium-overlay');
  const titleSub = document.getElementById('tour-podium-subtitle');
  
  // Setup subtitle
  if (tourMode === 'solo') {
    titleSub.innerHTML = `Disputa Solo Finalizada! Sua pontuação total: <b>${Math.round(sorted[0].totalScore)} pts</b>`;
  } else {
    titleSub.innerHTML = `🏆 O grande campeão é: <b style="color:var(--c2); font-size:1.15rem;">${sorted[0].name}</b> com <b>${Math.round(sorted[0].totalScore)} pts</b>!`;
  }
  
  // Populate visual podium steps
  const first = sorted[0];
  const second = sorted[1] || null;
  const third = sorted[2] || null;
  
  // 1st place
  document.getElementById('podium-1st-name').textContent = first.name;
  document.getElementById('podium-1st-score').textContent = `${Math.round(first.totalScore)} pts`;
  
  // 2nd place
  const pod2 = document.getElementById('podium-2nd');
  if (second) {
    pod2.style.display = 'flex';
    document.getElementById('podium-2nd-name').textContent = second.name;
    document.getElementById('podium-2nd-score').textContent = `${Math.round(second.totalScore)} pts`;
  } else {
    pod2.style.display = 'none';
  }
  
  // 3rd place
  const pod3 = document.getElementById('podium-3rd');
  if (third) {
    pod3.style.display = 'flex';
    document.getElementById('podium-3rd-name').textContent = third.name;
    document.getElementById('podium-3rd-score').textContent = `${Math.round(third.totalScore)} pts`;
  } else {
    pod3.style.display = 'none';
  }
  
  // Display Podium
  podiumOverlay.style.display = 'flex';
  
  // Trigger colorful Confetti celebration!
  startConfetti();
}

function exitTournament() {
  tourActive = false;
  tourPlayers = [];
  tourCurrentPlayerIdx = 0;
  tourCurrentRound = 1;
  
  // Hide podium and waiting screens
  document.getElementById('tour-podium-overlay').style.display = 'none';
  document.getElementById('tour-waiting-screen').style.display = 'none';
  document.getElementById('action-btns-wrap').style.display = 'flex';
  
  // Clean setup card UI and tabs
  renderTournamentPlayers();
  updateTournamentHeader();
  
  // Notify server to stop tournament
  fetch('/api/tournament/stop', { method: 'POST' }).then(() => {
    resetApp();
  });
}

// ── Confetti Celebration Animation ───────────────────────────────
function startConfetti() {
  const canvas = document.getElementById('podium-confetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Set dimensions based on card container
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  
  let particles = [];
  const colors = ['#7b61ff', '#ff6ef7', '#ffd54f', '#4caf50', '#00bcd4'];
  
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height - 20,
      r: Math.random() * 4 + 3,
      d: Math.random() * canvas.height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.05 + 0.02,
      tiltAngle: 0
    });
  }
  
  function draw() {
    const parent = document.getElementById('tour-podium-overlay');
    if (!parent || parent.style.display === 'none') return; // Stop animation loop when closed
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    particles.forEach((p, idx) => {
      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2.5;
      p.x += Math.sin(p.tiltAngle) * 0.5;
      p.tilt = Math.sin(p.tiltAngle - idx / 3) * 10;
      
      // Recycle particle if it falls off bottom
      if (p.y > canvas.height) {
        p.x = Math.random() * canvas.width;
        p.y = -20;
        p.tilt = Math.random() * 10 - 5;
      }
      
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    });
    
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Init ──────────────────────────────────────────────────────────
// ── Init ──────────────────────────────────────────────────────────
(async function init(){
  applyTheme(currentTheme);
  renderHistory();
  renderQueue();
  syncQueue();

  // Mover overlays para dentro do player-wrap para que continuem visíveis durante o modo Tela Cheia contínuo
  const pWrap = document.getElementById('player-wrap');
  const resOver = document.getElementById('result-overlay');
  const tourPod = document.getElementById('tour-podium-overlay');
  if (pWrap && resOver) pWrap.appendChild(resOver);
  if (pWrap && tourPod) pWrap.appendChild(tourPod);

  // Build pitch bars
  const wrap = document.getElementById('pitch-bars-wrap');
  if (wrap) {
    wrap.innerHTML = '';
    for(let i=0;i<24;i++){
      const b=document.createElement('div');
      b.className='pitch-bar';
      wrap.appendChild(b);
    }
  }

  // Release host when page is closed or reloaded
  window.addEventListener('beforeunload', () => {
    if (weAreHost) {
      navigator.sendBeacon('/api/host', JSON.stringify({ action: 'release', sessionId: hostSessionId }));
    }
  });

  // Add robust modern click event listeners for fullscreen functions to bypass potential cache/inline issues
  const fsBtn = document.getElementById('fs-btn');
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openFsOverlay();
    });
  }

  const fsCloseBtn = document.getElementById('fs-close-btn');
  if (fsCloseBtn) {
    fsCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeFsOverlay();
    });
  }

  // ── Auto-Remote Check ──────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('remote') === 'true') {
      // Force remote mode automatically
      setTimeout(() => {
        if (!isRemoteMode) {
          toggleRemoteMode();
        }
      }, 500);
    }
  });

  // Start polling live audience reactions for the Telão display
  setInterval(pollAudienceReactions, 800);
})();

// ── Live Audience Reactions System ──────────────────────────────────
async function sendAudienceReaction(emoji) {
  try {
    const r = await fetch('/api/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: emoji })
    });
    const toast = document.getElementById('reaction-sent-toast');
    if (toast) {
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 1500);
    }
    // Also trigger immediate local visual feedback
    spawnFloatingEmoji(emoji);
  } catch (e) {
    console.error('Erro ao enviar reação:', e);
  }
}

async function pollAudienceReactions() {
  // Only host telão processes and displays flying emojis
  if (!weAreHost && isRemoteMode) return;
  try {
    const r = await fetch('/api/reaction');
    if (r.ok) {
      const data = await r.json();
      if (data.reactions && data.reactions.length > 0) {
        data.reactions.forEach(react => {
          spawnFloatingEmoji(react.emoji);
        });
        if (data.bonusScore && data.bonusScore > 0) {
          score += 2;
          const scoreVal = document.getElementById('score-val');
          if (scoreVal) scoreVal.textContent = Math.round(score);
        }
      }
    }
  } catch (e) {}
}

function spawnFloatingEmoji(emoji) {
  const container = document.getElementById('player-wrap') || document.body;
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'floating-audience-emoji';
      el.innerText = emoji;
      el.style.position = 'absolute';
      el.style.left = (15 + Math.random() * 70) + '%';
      el.style.bottom = '10%';
      el.style.fontSize = (2 + Math.random() * 1.5) + 'rem';
      el.style.zIndex = '300';
      el.style.pointerEvents = 'none';
      el.style.transition = 'all 2s cubic-bezier(0.25, 1, 0.5, 1)';
      el.style.opacity = '1';
      container.appendChild(el);

      requestAnimationFrame(() => {
        el.style.transform = `translateY(-${200 + Math.random() * 150}px) scale(1.4) rotate(${Math.random() * 30 - 15}deg)`;
        el.style.opacity = '0';
      });

      setTimeout(() => el.remove(), 2100);
    }, i * 150);
  }
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8765;
const DIR = __dirname;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

let globalQueue = [];
let nextQueueId = 1;
let lastHostPing = 0;
let activeHostSessionId = null;

function isHostActive() {
  return (Date.now() - lastHostPing < 8000);
}

let tournamentState = {
  active: false,
  mode: 'solo',
  totalRounds: 3,
  currentRound: 1,
  currentPlayerIdx: 0,
  players: [],
  setupPlayers: []
};

let recentReactions = [];
let audienceBonusScore = 0;

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
    });
  });
}

http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  
  // API Route: Server info
  if (urlObj.pathname === '/api/server-info' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ localIp: getLocalIp(), port: PORT }));
    return;
  }

  // API Route: Host locking
  if (urlObj.pathname === '/api/host' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    readBody(req).then(data => {
      const active = isHostActive();
      if (data.action === 'claim') {
        if (!active || activeHostSessionId === data.sessionId) {
          lastHostPing = Date.now();
          activeHostSessionId = data.sessionId || 'default';
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(403); res.end(JSON.stringify({ error: 'Já existe um Telão ativo.' }));
        }
      } else if (data.action === 'ping') {
        if (data.sessionId === activeHostSessionId) {
          lastHostPing = Date.now();
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(403); res.end(JSON.stringify({ error: 'Session ID inválido.' }));
        }
      } else if (data.action === 'release') {
        if (data.sessionId === activeHostSessionId || !active) {
          lastHostPing = 0;
          activeHostSessionId = null;
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(403); res.end(JSON.stringify({ error: 'Apenas o telão ativo pode liberar.' }));
        }
      } else {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // API Route: Queue operations
  if (urlObj.pathname.startsWith('/api/queue')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (urlObj.pathname === '/api/queue/pop' && req.method === 'POST') {
      const popped = globalQueue.shift() || null;
      res.writeHead(200); res.end(JSON.stringify(popped));
      return;
    }

    if (urlObj.pathname === '/api/queue') {
      if (req.method === 'GET') {
        res.writeHead(200); res.end(JSON.stringify({ 
          queue: globalQueue, 
          hostActive: isHostActive(), 
          activeHostSessionId: activeHostSessionId,
          tournament: tournamentState 
        }));
        return;
      }
      if (req.method === 'POST') {
        readBody(req).then(data => {
          if (data.url) {
            globalQueue.push({ id: nextQueueId++, artist: data.artist||'?', track: data.track||'?', url: data.url, singer: data.singer||'', rounds: data.rounds||'1' });
          }
          res.writeHead(200); res.end(JSON.stringify({ success: true }));
        });
        return;
      }
      if (req.method === 'DELETE') {
        const id = parseInt(urlObj.searchParams.get('id'), 10);
        globalQueue = globalQueue.filter(q => q.id !== id);
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
        return;
      }
    }
  }

  // API Route: Live Audience Reactions
  if (urlObj.pathname.startsWith('/api/reaction')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'POST') {
      readBody(req).then(data => {
        if (data.emoji) {
          recentReactions.push({ emoji: data.emoji, ts: Date.now() });
          audienceBonusScore += (data.emoji === '❤️' || data.emoji === '🔥' || data.emoji === '👏') ? 2 : (data.emoji === '😭' ? 1 : 0);
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true, bonusScore: audienceBonusScore }));
      });
      return;
    }

    if (req.method === 'GET') {
      const now = Date.now();
      const newReactions = recentReactions.filter(r => now - r.ts < 5000);
      recentReactions = []; // drain
      res.writeHead(200); res.end(JSON.stringify({ reactions: newReactions, bonusScore: audienceBonusScore }));
      return;
    }
  }
  
  // API Route: Tournament Operations
  if (urlObj.pathname.startsWith('/api/tournament')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (urlObj.pathname === '/api/tournament/setup' && req.method === 'POST') {
      readBody(req).then(data => {
        if (data.mode !== undefined) tournamentState.mode = data.mode;
        if (data.totalRounds !== undefined) tournamentState.totalRounds = parseInt(data.totalRounds, 10);
        if (data.setupPlayers !== undefined) tournamentState.setupPlayers = data.setupPlayers;
        res.writeHead(200); res.end(JSON.stringify({ success: true, tournament: tournamentState }));
      });
      return;
    }

    if (urlObj.pathname === '/api/tournament/start' && req.method === 'POST') {
      readBody(req).then(data => {
        tournamentState.active = true;
        tournamentState.mode = data.mode || tournamentState.mode || 'solo';
        tournamentState.totalRounds = parseInt(data.totalRounds, 10) || tournamentState.totalRounds || 3;
        tournamentState.currentRound = 1;
        tournamentState.currentPlayerIdx = 0;
        
        const playersArray = data.players || tournamentState.setupPlayers || [];
        tournamentState.players = playersArray.map(p => ({
          name: p.name || p,
          scores: [],
          totalScore: 0,
          songs: Array(tournamentState.totalRounds).fill(null)
        }));
        
        res.writeHead(200); res.end(JSON.stringify({ success: true, tournament: tournamentState }));
      });
      return;
    }

    if (urlObj.pathname === '/api/tournament/song' && req.method === 'POST') {
      readBody(req).then(data => {
        const { playerIdx, roundIdx, song } = data;
        if (tournamentState.active && tournamentState.players[playerIdx]) {
          tournamentState.players[playerIdx].songs[roundIdx] = {
            artist: song.artist || '?',
            track: song.track || '?',
            url: song.url
          };
          res.writeHead(200); res.end(JSON.stringify({ success: true, tournament: tournamentState }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Nenhum torneio ativo ou jogador inválido.' }));
        }
      });
      return;
    }

    if (urlObj.pathname === '/api/tournament/state' && req.method === 'POST') {
      readBody(req).then(data => {
        if (tournamentState.active) {
          if (data.currentRound !== undefined) tournamentState.currentRound = data.currentRound;
          if (data.currentPlayerIdx !== undefined) tournamentState.currentPlayerIdx = data.currentPlayerIdx;
          if (data.players !== undefined) {
            data.players.forEach((p, idx) => {
              if (tournamentState.players[idx]) {
                tournamentState.players[idx].scores = p.scores || [];
                tournamentState.players[idx].totalScore = p.totalScore || 0;
              }
            });
          }
          res.writeHead(200); res.end(JSON.stringify({ success: true, tournament: tournamentState }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Nenhum torneio ativo.' }));
        }
      });
      return;
    }

    if (urlObj.pathname === '/api/tournament/stop' && req.method === 'POST') {
      tournamentState = {
        active: false,
        mode: 'solo',
        totalRounds: 3,
        currentRound: 1,
        currentPlayerIdx: 0,
        players: []
      };
      res.writeHead(200); res.end(JSON.stringify({ success: true }));
      return;
    }
  }

  // API Route: YouTube search
  if (urlObj.pathname === '/api/search-yt') {
    const q = urlObj.searchParams.get('q');
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Query parameter q is required' }));
      return;
    }
    
    // Auto append "karaoke" to guarantee relevant videos
    const searchQuery = `${q} karaoke`;
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    
    fetch(ytUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    })
    .then(r => r.text())
    .then(html => {
      let videos = [];
      
      // Try to parse ytInitialData JSON embedded block in HTML
      const match = html.match(/var ytInitialData\s*=\s*({.*?});<\/script>/s) || 
                    html.match(/window\["ytInitialData"\]\s*=\s*({.*?});<\/script>/s);
      
      if (match) {
        try {
          const json = JSON.parse(match[1]);
          const items = json.contents.twoColumnSearchResultRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
          
          for (let item of items) {
            if (item.videoRenderer) {
              const vr = item.videoRenderer;
              const videoId = vr.videoId;
              const title = vr.title?.runs?.[0]?.text || '';
              const channel = vr.ownerText?.runs?.[0]?.text || '';
              const duration = vr.lengthText?.simpleText || '';
              const thumb = vr.thumbnail?.thumbnails?.[0]?.url || '';
              
              if (videoId && title) {
                videos.push({ videoId, title, channel, duration, thumb });
              }
            }
            if (videos.length >= 15) break;
          }
        } catch (e) {
          console.error("JSON parsing error:", e);
        }
      }
      
      // Regex fallback if JSON block match failed or empty
      if (videos.length === 0) {
        const regex = /"videoRenderer":\s*\{\s*"videoId":\s*"([a-zA-Z0-9_-]{11})".*?"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/g;
        let m;
        while ((m = regex.exec(html)) !== null && videos.length < 15) {
          const videoId = m[1];
          const title = m[2].replace(/\\u0026/g, '&');
          if (videoId && title && !videos.some(v => v.videoId === videoId)) {
            videos.push({
              videoId,
              title,
              channel: 'YouTube',
              duration: '',
              thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            });
          }
        }
      }
      
      // Filter out non-embeddable videos by checking YouTube's oembed endpoint
      Promise.all(videos.map(async (v) => {
        try {
          const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.videoId}&format=json`);
          if (r.status === 200) return v;
          return null;
        } catch (e) {
          return v; // assume valid if network error
        }
      }))
      .then(results => {
        let validVideos = results.filter(v => v !== null).slice(0, 5); // Take top 5 valid
        
        // Fallback: if all failed validation (rare), just return original top 5
        if (validVideos.length === 0 && videos.length > 0) {
          validVideos = videos.slice(0, 5);
        }

        res.writeHead(200, { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ videos: validVideos }));
      });
    })
    .catch(err => {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Serve static files
  let pathname = urlObj.pathname === '/' ? 'index.html' : urlObj.pathname;
  let filePath = path.join(DIR, pathname);
  const ext = path.extname(filePath);
  
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => {
  const localIp = getLocalIp();
  console.log(`\n🎤 KaraokêApp rodando localmente em: http://localhost:${PORT}`);
  console.log(`🎤 Na sua rede local (para o celular): http://${localIp}:${PORT}\n`);
  console.log('Pressione Ctrl+C para parar.\n');
});

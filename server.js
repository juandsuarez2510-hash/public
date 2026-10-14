const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), server = http.createServer(app), io = new Server(server);

// Lee los archivos estáticos desde la carpeta actual donde está el proyecto
app.use(express.static(__dirname));
app.get('/', (q, r) => r.redirect('/player.html'));

const rooms = {};
const newPin = () => { let p; do p = String(100000 + Math.floor(Math.random() * 900000)); while (rooms[p]); return p; };

const board = r => Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
const list = r => io.to(r.host).emit('players', Object.values(r.players).map(p => p.name));

function next(r) {
  if (r.i + 1 >= r.q.length) {
    const b = board(r);
    io.to(r.host).emit('end', b.slice(0, 10));
    b.forEach((p, k) => io.to(p.id).emit('end', { rank: k + 1, score: p.score }));
    return;
  }
  r.i++; r.votes = {}; r.open = true; r.end = Date.now() + (r.time * 1000);
  io.to(r.pin).emit('question', { n: r.i + 1, total: r.q.length, text: r.q[r.i].t, time: r.time });
  r.timer = setTimeout(() => close(r), (r.time * 1000) + 300); // 300ms de gracia por latencia
}

function close(r) {
  r.open = false;
  const c = r.q[r.i].a; let t = 0, f = 0;
  for (const [id, p] of Object.entries(r.players)) {
    const v = r.votes[id]; if (v) v.a ? t++ : f++;
    const ok = !!v && v.a === c;
    p.gained = ok ? 500 + Math.round(500 * (v.left / (r.time * 1000))) : 0;
    p.ok = ok; p.answered = !!v; p.score += p.gained;
  }
  const b = board(r);
  b.forEach((x, k) => { const p = r.players[x.id]; io.to(x.id).emit('result', { answered: p.answered, correct: p.ok, gained: p.gained, score: p.score, rank: k + 1 }); });
  io.to(r.host).emit('results', { correct: c, t, f, none: b.length - t - f, board: b.slice(0, 5), last: r.i + 1 >= r.q.length });
}

io.on('connection', s => {
  const room = () => s.data.host && rooms[s.data.pin];
  s.on('host:create', ({ questions, time }, cb) => {
    if (!Array.isArray(questions) || !questions.length) return cb({ error: 'Agrega preguntas' });
    const pin = newPin();
    rooms[pin] = { pin, host: s.id, time: Math.min(120, Math.max(3, +time || 15)), players: {}, i: -1, open: false, votes: {},
      q: questions.slice(0, 100).map(x => ({ t: String(x.t).slice(0, 300), a: !!x.a })) };
    s.join(pin); s.data = { pin, host: true }; cb({ pin });
  });
  s.on('player:join', ({ pin, name }, cb) => {
    const r = rooms[pin]; name = String(name || '').trim().slice(0, 20);
    if (!r) return cb({ error: 'PIN inválido' });
    if (r.i >= 0) return cb({ error: 'La partida ya comenzó' });
    if (!name) return cb({ error: 'Escribe tu nombre' });
    if (Object.values(r.players).some(p => p.name.toLowerCase() === name.toLowerCase())) return cb({ error: 'Nombre en uso' });
    r.players[s.id] = { name, score: 0 }; s.join(pin); s.data = { pin }; cb({ ok: true }); list(r);
  });
  s.on('host:start', () => { const r = room(); if (r && r.i < 0) next(r); });
  s.on('host:next', () => { const r = room(); if (r && !r.open) next(r); });
  s.on('player:vote', a => {
    const r = rooms[s.data.pin];
    if (!r || !r.open || !r.players[s.id] || r.votes[s.id]) return;
    r.votes[s.id] = { a: !!a, left: Math.max(0, r.end - Date.now()) };
    io.to(r.host).emit('votes', Object.keys(r.votes).length);
  });
  s.on('disconnect', () => {
    const r = rooms[s.data.pin]; if (!r) return;
    if (s.data.host) { clearTimeout(r.timer); io.to(r.pin).emit('closed'); delete rooms[r.pin]; }
    else if (r.i < 0) { delete r.players[s.id]; list(r); }
  });
});

server.listen(process.env.PORT || 4000, () => console.log('Trivia en http://localhost:4000/host.html'));
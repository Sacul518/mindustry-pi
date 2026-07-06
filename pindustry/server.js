// Pindustry — kleines Mindustry-artiges Koop-Spiel für den Browser.
// Der Server simuliert das komplette Spiel; Browser-Clients senden nur
// Eingaben und rendern den Zustand. Transport: WebSockets (Port 8372,
// hinter nginx als /pindustry/ws).
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8372;

// --- Konstanten ---
const W = 48, H = 32;
const DT = 1 / 30;                    // Simulationsschritt
const BROADCAST_EVERY = 3;            // Zustand 10x pro Sekunde senden
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const BLOCKS = {
    conveyor: { cost: 2,  hp: 40  },
    wall:     { cost: 8,  hp: 250 },
    drill:    { cost: 20, hp: 80  },
    turret:   { cost: 30, hp: 120 },
};
const CORE_HP = 1200;
const START_COPPER = 80;
const WAVE_INTERVAL = 40;

// --- Zustand ---
let terrain, buildings, core, players, enemies, bullets, items;
let copper, wave, waveTimer, gameOver, resetTimer, nextEntityId;

function key(x, y) { return x + ',' + y; }

function genTerrain() {
    terrain = new Uint8Array(W * H); // 0 = Boden, 1 = Erz
    for (let blob = 0; blob < 10; blob++) {
        const cx = 2 + Math.floor(Math.random() * (W - 4));
        const cy = 2 + Math.floor(Math.random() * (H - 4));
        if (Math.abs(cx - W / 2) < 6 && Math.abs(cy - H / 2) < 6) continue;
        const r = 1.5 + Math.random() * 1.5;
        for (let x = Math.floor(cx - r); x <= cx + r; x++)
            for (let y = Math.floor(cy - r); y <= cy + r; y++)
                if (x >= 0 && y >= 0 && x < W && y < H &&
                    (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
                    terrain[y * W + x] = 1;
    }
}

function reset(regen) {
    if (regen) genTerrain();
    buildings = new Map();
    core = { type: 'core', x: W / 2 - 1, y: H / 2 - 1, hp: CORE_HP, maxhp: CORE_HP };
    for (let dx = 0; dx < 2; dx++)
        for (let dy = 0; dy < 2; dy++)
            buildings.set(key(core.x + dx, core.y + dy), core);
    enemies = [];
    bullets = [];
    items = [];
    copper = START_COPPER;
    wave = 0;
    waveTimer = WAVE_INTERVAL;
    gameOver = false;
    resetTimer = 0;
    for (const p of players.values()) { p.x = W / 2 + 2; p.y = H / 2; }
    broadcast({ t: 'reset' });
    sendFullTo(null);
}

function spawnWave() {
    wave++;
    const n = Math.min(3 + wave * 2, 40);
    for (let i = 0; i < n; i++) {
        const side = Math.floor(Math.random() * 4);
        let x, y;
        if (side === 0) { x = 0.5; y = Math.random() * H; }
        else if (side === 1) { x = W - 0.5; y = Math.random() * H; }
        else if (side === 2) { x = Math.random() * W; y = 0.5; }
        else { x = Math.random() * W; y = H - 0.5; }
        const hp = Math.round(25 * (1 + wave * 0.35));
        enemies.push({ id: nextEntityId++, x, y, hp, maxhp: hp,
                       speed: 1.1 + wave * 0.02, atk: 0 });
    }
    broadcast({ t: 'msg', text: 'Welle ' + wave + '!' });
}

function damageBuilding(b, dmg, bx, by) {
    b.hp -= dmg;
    if (b.hp > 0) return;
    if (b.type === 'core') {
        gameOver = true;
        resetTimer = 8;
        broadcast({ t: 'msg', text: 'Der Kern ist zerstört! Neustart in 8 Sekunden …' });
    } else {
        buildings.delete(key(bx, by));
        broadcast({ t: 'tile', x: bx, y: by, b: null });
    }
}

function buildingAt(fx, fy) {
    const x = Math.floor(fx), y = Math.floor(fy);
    return { b: buildings.get(key(x, y)), x, y };
}

function shoot(sx, sy, target, dmg) {
    const dx = target.x - sx, dy = target.y - sy;
    const len = Math.hypot(dx, dy) || 1;
    bullets.push({ x: sx, y: sy, vx: dx / len * 14, vy: dy / len * 14,
                   dmg, life: 1.2 });
}

function nearestEnemy(x, y, range) {
    let best = null, bd = range * range;
    for (const e of enemies) {
        const d = (e.x - x) ** 2 + (e.y - y) ** 2;
        if (d < bd) { bd = d; best = e; }
    }
    return best;
}

function tick() {
    if (gameOver) {
        resetTimer -= DT;
        if (resetTimer <= 0) reset(false);
        return;
    }

    waveTimer -= DT;
    if (waveTimer <= 0) { spawnWave(); waveTimer = WAVE_INTERVAL; }

    // Spieler: Bewegung + Auto-Schuss auf nächsten Gegner
    for (const p of players.values()) {
        p.x = Math.max(0.5, Math.min(W - 0.5, p.x + p.dx * 4.5 * DT));
        p.y = Math.max(0.5, Math.min(H - 0.5, p.y + p.dy * 4.5 * DT));
        p.cool -= DT;
        if (p.cool <= 0) {
            const e = nearestEnemy(p.x, p.y, 6.5);
            if (e) { shoot(p.x, p.y, e, 9); p.cool = 0.35; }
        }
    }

    // Gebäude
    for (const [k, b] of buildings) {
        if (b.type === 'drill') {
            b.timer = (b.timer || 0) + DT;
            if (b.timer >= 1.8) {
                const [dx, dy] = DIRS[b.rot];
                const nx = b.x + dx, ny = b.y + dy;
                const nb = buildings.get(key(nx, ny));
                if (nb && (nb.type === 'conveyor' || nb.type === 'core')) {
                    b.timer = 0;
                    if (nb.type === 'core') copper++;
                    else items.push({ x: nx + 0.5, y: ny + 0.5 });
                }
            }
        } else if (b.type === 'turret') {
            b.timer = (b.timer || 0) - DT;
            // Türme verbrauchen Eisen als Munition — ohne Vorrat schweigen sie
            if (b.timer <= 0 && copper >= 1) {
                const e = nearestEnemy(b.x + 0.5, b.y + 0.5, 7.5);
                if (e) { copper--; shoot(b.x + 0.5, b.y + 0.5, e, 16); b.timer = 0.6; }
            }
        }
    }

    // Items auf Förderbändern
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const { b } = buildingAt(it.x, it.y);
        if (!b || b.type !== 'conveyor') { items.splice(i, 1); continue; }
        const [dx, dy] = DIRS[b.rot];
        // zur Mittellinie des Bandes ziehen, damit Kurven sauber laufen
        const cx = Math.floor(it.x) + 0.5, cy = Math.floor(it.y) + 0.5;
        if (dx === 0) it.x += (cx - it.x) * 6 * DT; else it.y += (cy - it.y) * 6 * DT;
        const speed = 2.2;
        const nxf = it.x + dx * speed * DT, nyf = it.y + dy * speed * DT;
        const ahead = buildings.get(key(Math.floor(nxf + dx * 0.25), Math.floor(nyf + dy * 0.25)));
        const sameTile = Math.floor(nxf + dx * 0.25) === Math.floor(it.x) &&
                         Math.floor(nyf + dy * 0.25) === Math.floor(it.y);
        if (ahead && ahead.type === 'core') { copper++; items.splice(i, 1); continue; }
        if (sameTile || (ahead && ahead.type === 'conveyor')) { it.x = nxf; it.y = nyf; }
    }

    // Gegner: laufen zum Kern, greifen Gebäude im Weg an
    const corex = core.x + 1, corey = core.y + 1;
    for (const e of enemies) {
        const dx = corex - e.x, dy = corey - e.y;
        const len = Math.hypot(dx, dy) || 1;
        e.atk -= DT;
        if (len < 1.4) {
            if (e.atk <= 0) { damageBuilding(core, 15); e.atk = 1; }
            continue;
        }
        const ahead = buildingAt(e.x + dx / len * 0.7, e.y + dy / len * 0.7);
        if (ahead.b && ahead.b.type !== 'conveyor') {
            if (e.atk <= 0) { damageBuilding(ahead.b, 15, ahead.x, ahead.y); e.atk = 1; }
        } else {
            e.x += dx / len * e.speed * DT;
            e.y += dy / len * e.speed * DT;
        }
    }

    // Geschosse
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bl = bullets[i];
        bl.x += bl.vx * DT; bl.y += bl.vy * DT; bl.life -= DT;
        let hit = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if ((e.x - bl.x) ** 2 + (e.y - bl.y) ** 2 < 0.25) {
                e.hp -= bl.dmg;
                if (e.hp <= 0) { enemies.splice(j, 1); copper += 1; }
                hit = true;
                break;
            }
        }
        if (hit || bl.life <= 0 || bl.x < 0 || bl.y < 0 || bl.x > W || bl.y > H)
            bullets.splice(i, 1);
    }
}

// --- Netzwerk ---
const clients = new Map(); // ws -> Spieler

function broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of clients.keys())
        if (ws.readyState === WebSocket.OPEN) ws.send(s);
}

function buildingList() {
    const out = [];
    const seen = new Set();
    for (const [k, b] of buildings) {
        if (b.type === 'core') {
            if (seen.has(b)) continue;
            seen.add(b);
        }
        out.push({ x: b.x, y: b.y, type: b.type, rot: b.rot || 0 });
    }
    return out;
}

function sendFullTo(ws) {
    const msg = JSON.stringify({
        t: 'init', w: W, h: H,
        terrain: Array.from(terrain),
        buildings: buildingList(),
    });
    if (ws) ws.send(msg);
    else for (const c of clients.keys()) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function stateMsg() {
    return JSON.stringify({
        t: 'state',
        players: [...players.values()].map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2)]),
        enemies: enemies.map(e => [e.id, +e.x.toFixed(2), +e.y.toFixed(2), e.hp, e.maxhp]),
        bullets: bullets.map(b => [+b.x.toFixed(2), +b.y.toFixed(2)]),
        items: items.map(it => [+it.x.toFixed(2), +it.y.toFixed(2)]),
        core: core.hp, copper, wave,
        next: Math.max(0, Math.round(waveTimer)),
        over: gameOver,
    });
}

function handle(ws, p, m) {
    if (m.t === 'input') {
        const len = Math.hypot(m.dx || 0, m.dy || 0);
        p.dx = len > 1 ? m.dx / len : (m.dx || 0);
        p.dy = len > 1 ? m.dy / len : (m.dy || 0);
    } else if (m.t === 'place') {
        const def = BLOCKS[m.type];
        const x = m.x | 0, y = m.y | 0;
        if (!def || gameOver || x < 0 || y < 0 || x >= W || y >= H) return;
        if (buildings.has(key(x, y)) || copper < def.cost) return;
        if (m.type === 'drill' && terrain[y * W + x] !== 1) return;
        copper -= def.cost;
        const b = { type: m.type, x, y, rot: (m.rot | 0) % 4, hp: def.hp, maxhp: def.hp };
        buildings.set(key(x, y), b);
        broadcast({ t: 'tile', x, y, b: { type: b.type, rot: b.rot } });
    } else if (m.t === 'remove') {
        const x = m.x | 0, y = m.y | 0;
        const b = buildings.get(key(x, y));
        if (!b || b.type === 'core' || gameOver) return;
        copper += Math.ceil(BLOCKS[b.type].cost / 2);
        buildings.delete(key(x, y));
        broadcast({ t: 'tile', x, y, b: null });
    }
}

// --- HTTP (statische Dateien für lokalen Test) + WebSocket ---
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0].replace(/^\/pindustry/, '');
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(__dirname, 'public', path.normalize(p));
    if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
    const p = { id: nextEntityId++, x: W / 2 + 2, y: H / 2, dx: 0, dy: 0, cool: 0 };
    clients.set(ws, p);
    players.set(p.id, p);
    ws.send(JSON.stringify({ t: 'welcome', id: p.id }));
    sendFullTo(ws);
    broadcast({ t: 'msg', text: 'Ein Spieler ist beigetreten (' + players.size + ' online)' });
    ws.on('message', raw => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        handle(ws, p, m);
    });
    ws.on('close', () => {
        clients.delete(ws);
        players.delete(p.id);
    });
});

players = new Map();
nextEntityId = 1;
genTerrain();
reset(false);

let n = 0;
setInterval(() => {
    tick();
    if (++n % BROADCAST_EVERY === 0) {
        const s = stateMsg();
        for (const ws of clients.keys())
            if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }
}, DT * 1000);

server.listen(PORT, () => console.log('Pindustry-Server läuft auf Port ' + PORT));

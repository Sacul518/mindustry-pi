// Pindustry-Client: rendert den Serverzustand und schickt Eingaben.
(function () {
    var cv = document.getElementById('cv');
    var ctx = cv.getContext('2d');
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    var W = 0, H = 0, terrain = null;
    var buildings = {};            // "x,y" -> {type, rot}
    var myId = -1;
    var prev = null, curr = null;  // die letzten zwei Zustands-Snapshots
    var copper = 0, coreHp = 1, wave = 0, next = 0, over = false;
    var selected = 'conveyor', rot = 0, removeMode = false;
    var TILE = isTouch ? 34 : 30;

    var BLOCKS = {
        conveyor: { cost: 2,  name: 'Band'   },
        drill:    { cost: 20, name: 'Bohrer' },
        turret:   { cost: 30, name: 'Turm'   },
        wall:     { cost: 8,  name: 'Wand'   }
    };
    var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

    function resize() {
        cv.width = innerWidth * DPR;
        cv.height = innerHeight * DPR;
        cv.style.width = innerWidth + 'px';
        cv.style.height = innerHeight + 'px';
    }
    addEventListener('resize', resize);
    resize();

    // --- Original-Sprites aus Mindustry Classic (GPLv3, Anuken) laden.
    // Schlägt das fehl (z. B. lokaler Test ohne /classic/), bleiben die Vektorformen.
    var atlas = { img: null, regions: {} };
    (function loadSprites() {
        var base = '/classic/assets/sprites/';
        fetch(base + 'sprites.atlas')
            .then(function (r) { if (!r.ok) throw 0; return r.text(); })
            .then(function (text) {
                var lines = text.split('\n'), name = null;
                for (var i = 1; i < lines.length; i++) {
                    var l = lines[i];
                    if (!l.trim()) { name = null; continue; }
                    if (l[0] !== ' ' && l.indexOf(':') < 0) {
                        name = l.trim();
                        atlas.regions[name] = {};
                    } else if (name) {
                        var kv = l.trim().split(':');
                        var p = (kv[1] || '').split(',');
                        if (kv[0] === 'xy') { atlas.regions[name].x = +p[0]; atlas.regions[name].y = +p[1]; }
                        if (kv[0] === 'size') { atlas.regions[name].w = +p[0]; atlas.regions[name].h = +p[1]; }
                    }
                }
                var img = new Image();
                img.onload = function () { atlas.img = img; };
                img.src = base + 'sprites.png';
            })
            .catch(function () {});
    })();

    function sprite(name, x, y, w, h, quarterTurns) {
        var r = atlas.regions[name];
        if (!atlas.img || !r || r.w === undefined) return false;
        ctx.imageSmoothingEnabled = false;
        if (quarterTurns) {
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(quarterTurns * Math.PI / 2);
            ctx.drawImage(atlas.img, r.x, r.y, r.w, r.h, -w / 2, -h / 2, w, h);
            ctx.restore();
        } else {
            ctx.drawImage(atlas.img, r.x, r.y, r.w, r.h, x, y, w, h);
        }
        return true;
    }
    function variant(base, x, y) { return base + ((x * 7 + y * 13) % 3 + 1); }

    // Richtungspfeil (Chevron) über Gebäuden, damit man Orientierung erkennt
    function arrow(cx, cy, rot, size, color, width) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * Math.PI / 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-size * .35, -size * .45);
        ctx.lineTo(size * .35, 0);
        ctx.lineTo(-size * .35, size * .45);
        ctx.stroke();
        ctx.restore();
    }

    function hasOutput(b) {
        var d = DIRS[b.rot || 0];
        var nb = buildings[(b.x + d[0]) + ',' + (b.y + d[1])];
        return nb && (nb.type === 'conveyor' || nb.type === 'core');
    }

    // --- Netzwerk ---
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var wsUrl = proto + location.host +
        (location.pathname.indexOf('/pindustry') === 0 ? '/pindustry/ws' : '/ws');
    var ws, connEl = document.getElementById('conn'),
        connState = document.getElementById('connstate');

    function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = function () {
            connState.textContent = 'Verbunden! Tippe/klicke zum Start.';
            setTimeout(function () { connEl.style.display = 'none'; }, 1200);
        };
        ws.onclose = function () {
            connEl.style.display = 'flex';
            connState.textContent = 'Verbindung verloren – versuche es erneut …';
            setTimeout(connect, 2000);
        };
        ws.onmessage = function (ev) {
            var m = JSON.parse(ev.data);
            if (m.t === 'welcome') { myId = m.id; }
            else if (m.t === 'init') {
                W = m.w; H = m.h; terrain = m.terrain;
                buildings = {};
                m.buildings.forEach(function (b) {
                    buildings[b.x + ',' + b.y] = b;
                    if (b.type === 'core') {
                        buildings[(b.x + 1) + ',' + b.y] = b;
                        buildings[b.x + ',' + (b.y + 1)] = b;
                        buildings[(b.x + 1) + ',' + (b.y + 1)] = b;
                    }
                });
            }
            else if (m.t === 'tile') {
                if (m.b) buildings[m.x + ',' + m.y] = { x: m.x, y: m.y, type: m.b.type, rot: m.b.rot };
                else delete buildings[m.x + ',' + m.y];
            }
            else if (m.t === 'state') {
                prev = curr;
                curr = m;
                curr.at = performance.now();
                copper = m.copper; coreHp = m.core; wave = m.wave;
                next = m.next; over = m.over;
            }
            else if (m.t === 'msg') showMsg(m.text);
            else if (m.t === 'reset') { prev = curr = null; }
        };
    }
    connect();

    var msgEl = document.getElementById('msg'), msgTimer = null;
    function showMsg(text) {
        msgEl.textContent = text;
        clearTimeout(msgTimer);
        msgTimer = setTimeout(function () { msgEl.textContent = ''; }, 4000);
    }

    function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

    // --- Eingabe: WASD ---
    var keys = {};
    function sendInput(dx, dy) { send({ t: 'input', dx: dx, dy: dy }); }
    function keyInput() {
        var dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
        var dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
        sendInput(dx, dy);
    }
    addEventListener('keydown', function (e) {
        var k = e.key.toLowerCase();
        if (k === 'r') { rot = (rot + 1) % 4; updateBar(); }
        if ('wasd'.indexOf(k) >= 0 && !keys[k]) { keys[k] = true; keyInput(); }
    });
    addEventListener('keyup', function (e) {
        var k = e.key.toLowerCase();
        if ('wasd'.indexOf(k) >= 0) { keys[k] = false; keyInput(); }
    });

    // --- Eingabe: Joystick (Touch) ---
    var joy = document.getElementById('vjoy'), knob = document.getElementById('vknob');
    if (isTouch) joy.style.display = 'block';
    var joyId = null;
    function joyCenter() {
        var r = joy.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function joyMove(cx, cy) {
        var c = joyCenter(), dx = cx - c.x, dy = cy - c.y;
        var len = Math.hypot(dx, dy), max = 42;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        sendInput(dx / max, dy / max);
    }
    function joyEnd() { knob.style.transform = ''; sendInput(0, 0); }
    joy.addEventListener('pointerdown', function (e) {
        e.preventDefault(); joyId = e.pointerId;
        joy.setPointerCapture(e.pointerId); joyMove(e.clientX, e.clientY);
    });
    joy.addEventListener('pointermove', function (e) {
        if (e.pointerId === joyId) { e.preventDefault(); joyMove(e.clientX, e.clientY); }
    });
    function joyUp(e) { if (e.pointerId === joyId) { joyId = null; joyEnd(); } }
    joy.addEventListener('pointerup', joyUp);
    joy.addEventListener('pointercancel', joyUp);

    // --- Baumenü ---
    var bar = document.getElementById('bar');
    var ICONS = {
        conveyor: '<svg viewBox="0 0 24 24"><path d="M3 12h14m-5-5 5 5-5 5" stroke="#c9c6c0" stroke-width="2.4" fill="none"/></svg>',
        drill: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="#c9c6c0" stroke-width="2.2" fill="none"/><circle cx="12" cy="12" r="3" fill="#e8a860"/></svg>',
        turret: '<svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="9" rx="2" stroke="#c9c6c0" stroke-width="2" fill="none"/><path d="M12 10V3" stroke="#c9c6c0" stroke-width="2.6"/></svg>',
        wall: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke="#c9c6c0" stroke-width="2.4" fill="none"/></svg>',
        remove: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" stroke="#ff7f7f" stroke-width="2.6"/></svg>',
        rotate: '<svg viewBox="0 0 24 24"><path d="M17 6a8 8 0 1 0 3 6" stroke="#c9c6c0" stroke-width="2.2" fill="none"/><path d="M20 3v4h-4" stroke="#c9c6c0" stroke-width="2.2" fill="none"/></svg>'
    };
    function slot(id, label, sub, onTap) {
        var d = document.createElement('div');
        d.className = 'slot';
        d.id = 'slot-' + id;
        d.innerHTML = ICONS[id] + '<span>' + label + '</span>' +
            (sub ? '<span class="cost">' + sub + '</span>' : '');
        d.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); onTap(); });
        bar.appendChild(d);
    }
    Object.keys(BLOCKS).forEach(function (t) {
        slot(t, BLOCKS[t].name, BLOCKS[t].cost, function () {
            selected = t; removeMode = false; updateBar();
        });
    });
    slot('remove', 'Abriss', '', function () { removeMode = !removeMode; updateBar(); });
    slot('rotate', 'Drehen', '', function () { rot = (rot + 1) % 4; updateBar(); });
    function updateBar() {
        Object.keys(BLOCKS).forEach(function (t) {
            document.getElementById('slot-' + t).classList.toggle('sel', !removeMode && selected === t);
        });
        document.getElementById('slot-remove').classList.toggle('sel', removeMode);
        var arrows = ['→', '↓', '←', '↑'];
        document.querySelector('#slot-rotate span').textContent = 'Drehen ' + arrows[rot];
    }
    updateBar();

    // --- Bauen durch Antippen des Spielfelds ---
    var cam = { x: 0, y: 0 };
    function screenToTile(px, py) {
        return {
            x: Math.floor((px * DPR - cv.width / 2) / (TILE * DPR) + cam.x),
            y: Math.floor((py * DPR - cv.height / 2) / (TILE * DPR) + cam.y)
        };
    }
    var hover = null;
    cv.addEventListener('pointermove', function (e) {
        if (!isTouch) hover = screenToTile(e.clientX, e.clientY);
    });
    cv.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var t = screenToTile(e.clientX, e.clientY);
        if (removeMode || e.button === 2) send({ t: 'remove', x: t.x, y: t.y });
        else send({ t: 'place', x: t.x, y: t.y, type: selected, rot: rot });
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // --- Rendering ---
    function lerpList(pl, cl, f, idIdx) {
        if (!pl) return cl;
        var byId = {};
        pl.forEach(function (e) { byId[e[idIdx]] = e; });
        return cl.map(function (e) {
            var p = byId[e[idIdx]];
            if (!p) return e;
            var out = e.slice();
            out[idIdx + 1] = p[idIdx + 1] + (e[idIdx + 1] - p[idIdx + 1]) * f;
            out[idIdx + 2] = p[idIdx + 2] + (e[idIdx + 2] - p[idIdx + 2]) * f;
            return out;
        });
    }

    function draw() {
        requestAnimationFrame(draw);
        ctx.fillStyle = '#101216';
        ctx.fillRect(0, 0, cv.width, cv.height);
        if (!terrain || !curr) return;

        var f = 1;
        if (prev) f = Math.min(1.5, (performance.now() - curr.at) / 100);
        var players = lerpList(prev && prev.players, curr.players, f, 0);
        var enemies = lerpList(prev && prev.enemies, curr.enemies, f, 0);

        // Kamera folgt dem eigenen Spieler
        var me = null;
        players.forEach(function (p) { if (p[0] === myId) me = p; });
        if (me) { cam.x = me[1]; cam.y = me[2]; }
        cam.x = Math.max(0, Math.min(W, cam.x));
        cam.y = Math.max(0, Math.min(H, cam.y));

        var ts = TILE * DPR;
        var ox = cv.width / 2 - cam.x * ts, oy = cv.height / 2 - cam.y * ts;
        function tx(x) { return ox + x * ts; }
        function ty(y) { return oy + y * ts; }

        var x0 = Math.max(0, Math.floor(cam.x - cv.width / 2 / ts) - 1);
        var x1 = Math.min(W - 1, Math.ceil(cam.x + cv.width / 2 / ts) + 1);
        var y0 = Math.max(0, Math.floor(cam.y - cv.height / 2 / ts) - 1);
        var y1 = Math.min(H - 1, Math.ceil(cam.y + cv.height / 2 / ts) + 1);

        // Boden + Erz
        for (var x = x0; x <= x1; x++) {
            for (var y = y0; y <= y1; y++) {
                var isOre = terrain[y * W + x] === 1;
                if (isOre && sprite(variant('iron', x, y), tx(x), ty(y), ts + 1, ts + 1)) continue;
                if (!isOre && sprite(variant('stone', x, y), tx(x), ty(y), ts + 1, ts + 1)) continue;
                ctx.fillStyle = (x + y) % 2 ? '#22252b' : '#24272d';
                ctx.fillRect(tx(x), ty(y), ts + 1, ts + 1);
                if (isOre) {
                    ctx.fillStyle = '#8a6238';
                    ctx.fillRect(tx(x) + ts * .25, ty(y) + ts * .25, ts * .2, ts * .2);
                    ctx.fillRect(tx(x) + ts * .58, ty(y) + ts * .5, ts * .2, ts * .2);
                }
            }
        }

        // Gebäude
        var drawnCore = false;
        for (var k in buildings) {
            var b = buildings[k];
            var bx = tx(b.x), by = ty(b.y);
            if (b.x < x0 - 2 || b.x > x1 + 2 || b.y < y0 - 2 || b.y > y1 + 2) continue;
            if (b.type === 'core') {
                if (drawnCore) continue;
                drawnCore = true;
                if (!sprite('core', tx(b.x), ty(b.y), ts * 2, ts * 2)) {
                    ctx.fillStyle = '#3d6b4b';
                    ctx.fillRect(tx(b.x) + 2, ty(b.y) + 2, ts * 2 - 4, ts * 2 - 4);
                    ctx.fillStyle = '#8fe3a8';
                    ctx.fillRect(tx(b.x) + ts * .5, ty(b.y) + ts * .5, ts, ts);
                }
            } else if (b.type === 'conveyor') {
                if (sprite('conveyor', bx, by, ts, ts, b.rot)) {
                    arrow(bx + ts / 2, by + ts / 2, b.rot, ts * .38,
                          'rgba(255,255,255,.4)', 1.5 * DPR);
                } else {
                    ctx.fillStyle = '#3a3f48';
                    ctx.fillRect(bx + 1, by + 1, ts - 2, ts - 2);
                    ctx.save();
                    ctx.translate(bx + ts / 2, by + ts / 2);
                    ctx.rotate(b.rot * Math.PI / 2);
                    ctx.strokeStyle = '#7a828e'; ctx.lineWidth = 2 * DPR;
                    ctx.beginPath();
                    ctx.moveTo(-ts * .2, -ts * .18); ctx.lineTo(ts * .05, 0); ctx.lineTo(-ts * .2, ts * .18);
                    ctx.moveTo(ts * .05, -ts * .18); ctx.lineTo(ts * .3, 0); ctx.lineTo(ts * .05, ts * .18);
                    ctx.stroke();
                    ctx.restore();
                }
            } else if (b.type === 'wall') {
                if (!sprite('ironwall', bx, by, ts, ts)) {
                    ctx.fillStyle = '#5c636e';
                    ctx.fillRect(bx + 1, by + 1, ts - 2, ts - 2);
                    ctx.strokeStyle = '#7a828e'; ctx.lineWidth = DPR;
                    ctx.strokeRect(bx + ts * .2, by + ts * .2, ts * .6, ts * .6);
                }
            } else if (b.type === 'drill') {
                if (!sprite('irondrill', bx, by, ts, ts)) {
                    ctx.fillStyle = '#4a4438';
                    ctx.fillRect(bx + 1, by + 1, ts - 2, ts - 2);
                    ctx.beginPath();
                    ctx.arc(bx + ts / 2, by + ts / 2, ts * .3, 0, 7);
                    ctx.fillStyle = '#e8a860'; ctx.fill();
                }
                // Ausgangsrichtung deutlich markieren
                var dd = DIRS[b.rot || 0];
                arrow(bx + ts / 2 + dd[0] * ts * .32, by + ts / 2 + dd[1] * ts * .32,
                      b.rot || 0, ts * .34, 'rgba(255,211,127,.95)', 2 * DPR);
                // ohne Band/Kern am Ausgang: blinkendes Warnzeichen
                if (!hasOutput(b) && (Date.now() / 500 | 0) % 2 === 0) {
                    ctx.font = 'bold ' + (ts * .7) + 'px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 3 * DPR;
                    ctx.strokeStyle = '#000';
                    ctx.strokeText('!', bx + ts / 2, by - ts * .15);
                    ctx.fillStyle = '#ff6b6b';
                    ctx.fillText('!', bx + ts / 2, by - ts * .15);
                }
            } else if (b.type === 'turret') {
                // ohne Munition (Eisen = 0) ausgegraut
                if (copper < 1) ctx.globalAlpha = 0.45;
                var ok = sprite('block', bx, by, ts, ts);
                if (ok) sprite('turret', bx - ts * .1, by - ts * .1, ts * 1.2, ts * 1.2);
                if (!ok) {
                    ctx.fillStyle = '#414d5e';
                    ctx.fillRect(bx + 1, by + 1, ts - 2, ts - 2);
                    ctx.beginPath();
                    ctx.arc(bx + ts / 2, by + ts / 2, ts * .26, 0, 7);
                    ctx.fillStyle = '#7fc7ff'; ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
        }

        // Items auf Bändern
        curr.items.forEach(function (it) {
            if (!sprite('icon-iron', tx(it[0]) - ts * .18, ty(it[1]) - ts * .18, ts * .36, ts * .36)) {
                ctx.fillStyle = '#e8a860';
                ctx.fillRect(tx(it[0]) - ts * .12, ty(it[1]) - ts * .12, ts * .24, ts * .24);
            }
        });

        // Gegner
        enemies.forEach(function (e) {
            var ex = tx(e[1]), ey = ty(e[2]);
            if (!sprite('standardenemy-t1', ex - ts * .38, ey - ts * .38, ts * .76, ts * .76)) {
                ctx.fillStyle = '#d15b5b';
                ctx.fillRect(ex - ts * .3, ey - ts * .3, ts * .6, ts * .6);
            }
            ctx.fillStyle = '#552222';
            ctx.fillRect(ex - ts * .3, ey - ts * .45, ts * .6, ts * .08);
            ctx.fillStyle = '#ff9f9f';
            ctx.fillRect(ex - ts * .3, ey - ts * .45, ts * .6 * (e[3] / e[4]), ts * .08);
        });

        // Geschosse
        ctx.fillStyle = '#ffd37f';
        curr.bullets.forEach(function (b) {
            ctx.beginPath();
            ctx.arc(tx(b[0]), ty(b[1]), ts * .09, 0, 7);
            ctx.fill();
        });

        // Spieler
        players.forEach(function (p) {
            var px = tx(p[1]), py = ty(p[2]);
            if (sprite('mech-standard', px - ts * .42, py - ts * .42, ts * .84, ts * .84)) {
                if (p[0] === myId) {
                    ctx.strokeStyle = 'rgba(127,199,255,.8)';
                    ctx.lineWidth = 2 * DPR;
                    ctx.beginPath();
                    ctx.arc(px, py, ts * .5, 0, 7);
                    ctx.stroke();
                }
                return;
            }
            ctx.save();
            ctx.translate(px, py);
            ctx.fillStyle = p[0] === myId ? '#7fc7ff' : '#8fe3a8';
            ctx.beginPath();
            ctx.moveTo(0, -ts * .32);
            ctx.lineTo(ts * .26, ts * .26);
            ctx.lineTo(-ts * .26, ts * .26);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        });

        // Turm ausgewählt: Reichweite aller Türme anzeigen (hilft beim Planen)
        if (selected === 'turret' && !removeMode) {
            ctx.strokeStyle = 'rgba(127,199,255,.35)';
            ctx.lineWidth = 1.5 * DPR;
            for (var tk in buildings) {
                var tb = buildings[tk];
                if (tb.type !== 'turret') continue;
                ctx.beginPath();
                ctx.arc(tx(tb.x + 0.5), ty(tb.y + 0.5), 7.5 * ts, 0, 7);
                ctx.stroke();
            }
        }

        // Bau-Vorschau (Desktop): Block halbtransparent mit Drehung anzeigen
        if (hover && !isTouch && !removeMode) {
            var SPRITES = { conveyor: 'conveyor', drill: 'irondrill', turret: 'turret', wall: 'ironwall' };
            ctx.globalAlpha = 0.55;
            sprite(SPRITES[selected], tx(hover.x), ty(hover.y), ts, ts,
                   selected === 'conveyor' ? rot : 0);
            ctx.globalAlpha = 1;
            if (selected === 'drill' || selected === 'conveyor') {
                var hd = DIRS[rot];
                arrow(tx(hover.x) + ts / 2 + hd[0] * ts * .32, ty(hover.y) + ts / 2 + hd[1] * ts * .32,
                      rot, ts * .34, 'rgba(255,211,127,.95)', 2 * DPR);
            }
            if (selected === 'turret') {
                ctx.strokeStyle = 'rgba(127,199,255,.5)';
                ctx.lineWidth = 1.5 * DPR;
                ctx.beginPath();
                ctx.arc(tx(hover.x) + ts / 2, ty(hover.y) + ts / 2, 7.5 * ts, 0, 7);
                ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(255,211,127,.7)';
            ctx.lineWidth = 2 * DPR;
            ctx.strokeRect(tx(hover.x) + 1, ty(hover.y) + 1, ts - 2, ts - 2);
        }

        // HUD-Werte
        document.getElementById('copper').textContent = copper;
        document.getElementById('wave').textContent = wave;
        document.getElementById('next').textContent = next;
        document.getElementById('corefill').style.width =
            Math.max(0, coreHp / 1200 * 100) + '%';
    }
    requestAnimationFrame(draw);
})();

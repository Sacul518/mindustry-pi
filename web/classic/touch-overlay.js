// Touch-Steuerung für Mindustry Classic im Browser.
// Das GWT-Spiel kennt nur Tastatur (WASD) + Maus. Auf Touch-Geräten legt dieses
// Overlay einen virtuellen Joystick (links, erzeugt synthetische WASD-Key-Events)
// und Knöpfe für R/ESC (rechts) über das Spiel. Tippen auf das Spielfeld selbst
// geht als normales Touch-Event ans Spiel (libGDX behandelt das wie Mausklicks).
(function () {
    var FORCE = /[?&]touch=1/.test(location.search);
    var DEBUG = /[?&]debug=1/.test(location.search);
    var isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouchDevice && !FORCE) return;

    var style = document.createElement('style');
    style.textContent = [
        'html, body { overscroll-behavior: none; }',
        'canvas { touch-action: none; }',
        '#vjoy, #vbtns, #vdebug { position: fixed; z-index: 9999;',
        '  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }',
        '#vjoy { left: calc(20px + env(safe-area-inset-left));',
        '  bottom: calc(20px + env(safe-area-inset-bottom));',
        '  width: 140px; height: 140px; border-radius: 50%;',
        '  background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.25);',
        '  touch-action: none; }',
        '#vknob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px;',
        '  margin: -28px 0 0 -28px; border-radius: 50%;',
        '  background: rgba(255,211,127,.55); border: 2px solid rgba(255,211,127,.9); }',
        '#vbtns { right: calc(16px + env(safe-area-inset-right));',
        '  bottom: calc(24px + env(safe-area-inset-bottom));',
        '  display: flex; flex-direction: column; gap: 14px; touch-action: none; }',
        '.vbtn { width: 58px; height: 58px; border-radius: 50%;',
        '  background: rgba(255,255,255,.10); border: 2px solid rgba(255,255,255,.3);',
        '  color: rgba(255,255,255,.85); font: 600 13px -apple-system, sans-serif;',
        '  display: flex; align-items: center; justify-content: center; touch-action: none; }',
        '.vbtn.active { background: rgba(255,211,127,.4); }',
        '#vdebug { top: 4px; left: 4px; color: #0f0; font: 12px monospace;',
        '  background: rgba(0,0,0,.5); padding: 2px 6px; pointer-events: none; }'
    ].join('\n');
    document.head.appendChild(style);

    var dbgEl = null;
    function dbg(msg) {
        if (!DEBUG) return;
        if (!dbgEl) {
            dbgEl = document.createElement('div');
            dbgEl.id = 'vdebug';
            document.body.appendChild(dbgEl);
        }
        dbgEl.textContent = msg;
    }

    // iOS-Pinch-Zoom außerhalb des Canvas unterbinden
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

    function sendKey(type, keyCode, key, code) {
        var target = document.querySelector('canvas') || document.body;
        var ev;
        try {
            ev = new KeyboardEvent(type, {
                bubbles: true, cancelable: true,
                key: key, code: code, keyCode: keyCode, which: keyCode
            });
        } catch (e) {
            ev = document.createEvent('Event');
            ev.initEvent(type, true, true);
        }
        // Der alte GWT-Code liest event.keyCode; manche Browser übernehmen den
        // Wert aus dem Konstruktor nicht – dann hier erzwingen.
        if (ev.keyCode !== keyCode) {
            Object.defineProperty(ev, 'keyCode', { get: function () { return keyCode; } });
            Object.defineProperty(ev, 'which', { get: function () { return keyCode; } });
        }
        target.dispatchEvent(ev);
        dbg(type + ' ' + key);
    }

    var KEYS = {
        w: { keyCode: 87, key: 'w', code: 'KeyW' },
        a: { keyCode: 65, key: 'a', code: 'KeyA' },
        s: { keyCode: 83, key: 's', code: 'KeyS' },
        d: { keyCode: 68, key: 'd', code: 'KeyD' }
    };
    var pressed = {};

    function setPressed(next) {
        for (var k in KEYS) {
            if (next[k] && !pressed[k]) sendKey('keydown', KEYS[k].keyCode, KEYS[k].key, KEYS[k].code);
            if (!next[k] && pressed[k]) sendKey('keyup', KEYS[k].keyCode, KEYS[k].key, KEYS[k].code);
        }
        pressed = next;
    }

    // --- Joystick ---
    var joy = document.createElement('div');
    joy.id = 'vjoy';
    var knob = document.createElement('div');
    knob.id = 'vknob';
    joy.appendChild(knob);
    document.body.appendChild(joy);

    var R = 70;          // Radius der Joystick-Basis
    var DEAD = 0.30;     // Totzone (Anteil von R) pro Achse

    function joyMove(dx, dy) {
        var len = Math.sqrt(dx * dx + dy * dy);
        var max = R - 28;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        setPressed({
            a: dx < -DEAD * R, d: dx > DEAD * R,
            w: dy < -DEAD * R, s: dy > DEAD * R
        });
    }

    function joyEnd() {
        knob.style.transform = '';
        setPressed({});
    }

    var joyPointer = null;
    function center() {
        var r = joy.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    if (window.PointerEvent) {
        joy.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            joyPointer = e.pointerId;
            joy.setPointerCapture(e.pointerId);
            var c = center();
            joyMove(e.clientX - c.x, e.clientY - c.y);
        });
        joy.addEventListener('pointermove', function (e) {
            if (e.pointerId !== joyPointer) return;
            e.preventDefault();
            var c = center();
            joyMove(e.clientX - c.x, e.clientY - c.y);
        });
        function joyUp(e) {
            if (e.pointerId !== joyPointer) return;
            joyPointer = null;
            joyEnd();
        }
        joy.addEventListener('pointerup', joyUp);
        joy.addEventListener('pointercancel', joyUp);
    } else {
        joy.addEventListener('touchstart', function (e) {
            e.preventDefault();
            var t = e.changedTouches[0];
            joyPointer = t.identifier;
            var c = center();
            joyMove(t.clientX - c.x, t.clientY - c.y);
        }, { passive: false });
        joy.addEventListener('touchmove', function (e) {
            e.preventDefault();
            for (var i = 0; i < e.changedTouches.length; i++) {
                var t = e.changedTouches[i];
                if (t.identifier !== joyPointer) continue;
                var c = center();
                joyMove(t.clientX - c.x, t.clientY - c.y);
            }
        }, { passive: false });
        joy.addEventListener('touchend', function () { joyPointer = null; joyEnd(); });
        joy.addEventListener('touchcancel', function () { joyPointer = null; joyEnd(); });
    }

    // --- Knöpfe rechts: Rotieren (R) und Menü (ESC) ---
    var btns = document.createElement('div');
    btns.id = 'vbtns';
    document.body.appendChild(btns);

    function addButton(label, keyCode, key, code) {
        var b = document.createElement('div');
        b.className = 'vbtn';
        b.textContent = label;
        btns.appendChild(b);
        function down(e) {
            e.preventDefault();
            b.classList.add('active');
            sendKey('keydown', keyCode, key, code);
        }
        function up(e) {
            if (e) e.preventDefault();
            b.classList.remove('active');
            sendKey('keyup', keyCode, key, code);
        }
        if (window.PointerEvent) {
            b.addEventListener('pointerdown', down);
            b.addEventListener('pointerup', up);
            b.addEventListener('pointercancel', up);
        } else {
            b.addEventListener('touchstart', down, { passive: false });
            b.addEventListener('touchend', up);
            b.addEventListener('touchcancel', up);
        }
    }
    addButton('R', 82, 'r', 'KeyR');
    addButton('ESC', 27, 'Escape', 'Escape');
})();

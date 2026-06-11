// ==UserScript==
// @name         OpenGuessr cheat
// @namespace    monowe
// @version      1.4
// @description  Easy to use location hack/cheat
// @match        https://www.openguessr.com/*
// @match        https://openguessr.com/*
// @grant        none
// @run-at       document-start
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/578787/OpenGuessr%20cheat.user.js
// @updateURL https://update.greasyfork.org/scripts/578787/OpenGuessr%20cheat.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const ANIMATION_DURATION = 2500;
    const MAP_SIZES = {
        small:  { w: 220, h: 160 },
        medium: { w: 280, h: 220 },
        large:  { w: 380, h: 300 },
    };
    const SETTINGS_KEY = 'monowe-settings';
    const defaults = { size: 'medium', theme: 'dark', opacity: 95, showWelcome: true, hotkey: 'KeyM' };
    let settings = { ...defaults };
    try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
    function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    function getMapSize() { return MAP_SIZES[settings.size] || MAP_SIZES.medium; }

    // ─── LOAD LEAFLET ─────────────────────────────────────────────
    const leafletCSS = document.createElement('link');
    leafletCSS.rel = 'stylesheet';
    leafletCSS.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    (document.head || document.documentElement).appendChild(leafletCSS);

    const leafletJS = document.createElement('script');
    leafletJS.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    (document.head || document.documentElement).appendChild(leafletJS);

    // ─── COORDINATE SYSTEM ────────────────────────────────────────
    const listeners = [];
    let lastCoords = null;

    function emitCoords(coords) {
        if (!coords || !isFinite(coords.lat) || !isFinite(coords.lng)) return;
        if (coords.lat === 0 && coords.lng === 0) return;
        if (lastCoords && lastCoords.lat === coords.lat && lastCoords.lng === coords.lng) return;
        lastCoords = coords;
        console.log('[monowe] coords found:', coords.lat, coords.lng);
        for (const fn of listeners) fn(coords);
    }

    // ─── METHOD 1: Hook Google Maps API ──────────────────────────
    function hookGoogleMapsAPI() {
        const check = setInterval(() => {
            if (!window.google || !window.google.maps) return;
            clearInterval(check);

            console.log('[monowe] Google Maps API detected, hooking...');
            const SVP = window.google.maps.StreetViewPanorama;
            if (!SVP) return;

            const instances = new Set();

            const origCtor = SVP;
            const handler = {
                construct(target, args) {
                    const instance = new target(...args);
                    instances.add(instance);
                    hookInstance(instance);
                    setTimeout(() => readPosition(instance), 500);
                    return instance;
                }
            };
            const proxied = new Proxy(origCtor, handler);
            window.google.maps.StreetViewPanorama = proxied;
            proxied.prototype = origCtor.prototype;

            const scanExisting = () => {
                try {
                    const containers = document.querySelectorAll('.gm-style, [aria-roledescription="street view"]');
                    for (const el of containers) {
                        for (const key of Object.keys(el)) {
                            if (key.startsWith('__')) {
                                const obj = el[key];
                                if (obj && typeof obj === 'object' && typeof obj.getPosition === 'function') {
                                    if (!instances.has(obj)) {
                                        instances.add(obj);
                                        hookInstance(obj);
                                    }
                                }
                            }
                        }
                    }
                } catch {}
            };

            function readPosition(pano) {
                try {
                    if (typeof pano.getPosition === 'function') {
                        const pos = pano.getPosition();
                        if (pos) {
                            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                            if (lat && lng) emitCoords({ lat, lng });
                        }
                    }
                } catch {}
            }

            function hookInstance(pano) {
                if (typeof pano.setPosition === 'function' && !pano._monoweHooked) {
                    pano._monoweHooked = true;
                    const origSetPos = pano.setPosition.bind(pano);
                    pano.setPosition = function (latLng) {
                        const result = origSetPos(latLng);
                        setTimeout(() => readPosition(pano), 100);
                        return result;
                    };
                }
                if (typeof pano.set === 'function' && !pano._monoweSetHooked) {
                    pano._monoweSetHooked = true;
                    const origSet = pano.set.bind(pano);
                    pano.set = function (key, value) {
                        const result = origSet(key, value);
                        if (key === 'position') {
                            setTimeout(() => readPosition(pano), 100);
                        }
                        return result;
                    };
                }
            }

            const scanInterval = setInterval(() => {
                scanExisting();
                for (const pano of instances) readPosition(pano);
            }, 2000);

            scanExisting();
            for (const pano of instances) readPosition(pano);

            cleanupFns.push(() => clearInterval(scanInterval));
        }, 500);
    }

    // ─── METHOD 2: Intercept fetch/XHR ───────────────────────────
    function hookNetwork() {
        function extractCoords(text) {
            const patterns = [
                /"lat(?:itude)?"\s*:\s*(-?\d+\.?\d*)\s*,\s*"(?:lng|lo(?:ng|n(?:g|itude)?))"\s*:\s*(-?\d+\.?\d*)/i,
                /"(?:lng|lo(?:ng|n(?:g|itude)?))"\s*:\s*(-?\d+\.?\d*)\s*,\s*"lat(?:itude)?"\s*:\s*(-?\d+\.?\d*)/i,
            ];
            for (const re of patterns) {
                const m = text.match(re);
                if (m) {
                    const a = parseFloat(m[1]), b = parseFloat(m[2]);
                    if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0)) return { lat: a, lng: b };
                }
            }
            return null;
        }

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            const resp = await origFetch.apply(this, args);
            try {
                const clone = resp.clone();
                clone.text().then((t) => {
                    const c = extractCoords(t);
                    if (c) emitCoords(c);
                }).catch(() => {});
            } catch {}
            return resp;
        };

        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u, ...r) {
            this._mUrl = u;
            return origOpen.call(this, m, u, ...r);
        };
        XMLHttpRequest.prototype.send = function (...a) {
            this.addEventListener('load', function () {
                try {
                    const c = extractCoords(this.responseText);
                    if (c) emitCoords(c);
                } catch {}
            });
            return origSend.apply(this, a);
        };

        cleanupFns.push(() => {
            window.fetch = origFetch;
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
        });
    }

    // ─── METHOD 3: Hook JSONP callbacks ──────────────────────────
    function hookJSONP() {
        const origAppendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function (node) {
            if (node.tagName === 'SCRIPT' && node.src) {
                if (node.src.includes('maps.googleapis.com') || node.src.includes('callback=')) {
                    node.addEventListener('load', () => {
                        try { scanGlobalScope(); } catch {}
                    });
                }
            }
            return origAppendChild.call(this, node);
        };

        const scanInterval = setInterval(scanGlobalScope, 3000);

        cleanupFns.push(() => {
            Node.prototype.appendChild = origAppendChild;
            clearInterval(scanInterval);
        });
    }

    function scanGlobalScope() {
        try {
            for (const key in window) {
                try {
                    const obj = window[key];
                    if (!obj || typeof obj !== 'object') continue;
                    if (typeof obj.getPosition === 'function') {
                        const pos = obj.getPosition();
                        if (pos) {
                            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                            if (lat && lng) emitCoords({ lat, lng });
                        }
                    }
                    if (obj.pano && typeof obj.pano.getPosition === 'function') {
                        const pos = obj.pano.getPosition();
                        if (pos) {
                            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                            if (lat && lng) emitCoords({ lat, lng });
                        }
                    }
                    if (obj.position && typeof obj.position === 'object') {
                        const lat = obj.position.lat;
                        const lng = obj.position.lng;
                        if (lat && lng && isFinite(lat) && isFinite(lng)) {
                            emitCoords({ lat: typeof lat === 'function' ? lat() : lat, lng: typeof lng === 'function' ? lng() : lng });
                        }
                    }
                } catch {}
            }
        } catch {}
    }

    // ─── METHOD 4: MutationObserver on iframes ──────────────────
    function hookIframes() {
        function extractFromUrl(url) {
            if (!url) return;
            const cbll = url.match(/cbll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (cbll) emitCoords({ lat: parseFloat(cbll[1]), lng: parseFloat(cbll[2]) });
            const loc = url.match(/location=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (loc) emitCoords({ lat: parseFloat(loc[1]), lng: parseFloat(loc[2]) });
        }

        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.tagName === 'IFRAME') {
                        extractFromUrl(node.src || node.getAttribute('src') || '');
                    }
                    if (node.querySelectorAll) {
                        for (const iframe of node.querySelectorAll('iframe')) {
                            extractFromUrl(iframe.src || iframe.getAttribute('src') || '');
                        }
                    }
                }
                if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IFRAME') {
                    extractFromUrl(m.target.src);
                }
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src'],
        });

        setTimeout(() => {
            for (const iframe of document.querySelectorAll('iframe')) {
                extractFromUrl(iframe.src || iframe.getAttribute('src') || '');
            }
        }, 2000);

        cleanupFns.push(() => observer.disconnect());
    }

    // ─── METHOD 5: Scan page HTML ────────────────────────────────
    function scanPageHTML() {
        const html = document.documentElement.innerHTML;
        const patterns = [
            /cbll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
            /location=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
            /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m) {
                emitCoords({ lat: parseFloat(m[1]), lng: parseFloat(m[2]) });
                return;
            }
        }
    }

    // ─── CLEANUP ─────────────────────────────────────────────────
    const cleanupFns = [];

    // ─── ANIMATION OVERLAY ───────────────────────────────────────
    function showWelcomeAnimation() {
        return new Promise((resolve) => {
            if (!settings.showWelcome) { resolve(); return; }

            const overlay = document.createElement('div');
            overlay.id = 'monowe-welcome';
            overlay.innerHTML = `
                <canvas id="monowe-particles"></canvas>
                <div class="monowe-text">
                    <span class="monowe-made">Made by</span>
                    <span class="monowe-name">monowe</span>
                </div>
            `;
            document.body.appendChild(overlay);

            const style = document.createElement('style');
            style.textContent = `
                #monowe-welcome {
                    position: fixed; inset: 0; z-index: 9999999;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(0,0,0,0.85); backdrop-filter: blur(20px);
                    transition: opacity 0.8s ease;
                }
                #monowe-welcome.fade-out { opacity: 0; pointer-events: none; }
                #monowe-particles {
                    position: absolute; inset: 0; width: 100%; height: 100%;
                }
                .monowe-text {
                    position: relative; z-index: 1; text-align: center;
                    animation: monowe-fadein 1s ease;
                }
                .monowe-made {
                    display: block; color: rgba(255,255,255,0.5);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 0.9rem; letter-spacing: 0.15em; text-transform: uppercase;
                    margin-bottom: 6px;
                }
                .monowe-name {
                    display: block; color: #00d4ff;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 2.4rem; font-weight: 700; letter-spacing: 0.08em;
                    text-shadow: 0 0 30px rgba(0,212,255,0.4);
                }
                @keyframes monowe-fadein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `;
            document.head.appendChild(style);

            const canvas = document.getElementById('monowe-particles');
            const ctx = canvas.getContext('2d');
            let particles = [];
            let animFrame;

            function resizeCanvas() {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            for (let i = 0; i < 80; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: (Math.random() - 0.5) * 0.5,
                    r: Math.random() * 2 + 0.5,
                    a: Math.random() * 0.5 + 0.1,
                });
            }

            function drawParticles() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                for (const p of particles) {
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < 0) p.x = canvas.width;
                    if (p.x > canvas.width) p.x = 0;
                    if (p.y < 0) p.y = canvas.height;
                    if (p.y > canvas.height) p.y = 0;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255,255,255,${p.a})`;
                    ctx.fill();
                }
                animFrame = requestAnimationFrame(drawParticles);
            }
            drawParticles();

            setTimeout(() => {
                overlay.classList.add('fade-out');
                cancelAnimationFrame(animFrame);
                setTimeout(() => {
                    overlay.remove();
                    style.remove();
                    resolve();
                }, 800);
            }, ANIMATION_DURATION);
        });
    }

    // ─── THEME ───────────────────────────────────────────────────
    function getThemeColors() {
        return settings.theme === 'light' ? {
            bg: 'rgba(245,245,250,0.97)',
            headerBg: 'rgba(0,0,0,0.06)',
            text: 'rgba(20,20,30,0.9)',
            textDim: 'rgba(20,20,30,0.5)',
            accent: '#0077cc',
            border: 'rgba(0,0,0,0.1)',
            btnHover: '#0077cc',
            shadow: '0 4px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08)',
            locName: '#0077cc',
        } : {
            bg: 'rgba(18,18,18,0.95)',
            headerBg: 'rgba(0,0,0,0.4)',
            text: 'rgba(255,255,255,0.85)',
            textDim: 'rgba(255,255,255,0.45)',
            accent: '#00d4ff',
            border: 'rgba(255,255,255,0.08)',
            btnHover: '#fff',
            shadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
            locName: '#00d4ff',
        };
    }

    // ─── MINI-MAP ────────────────────────────────────────────────
    let mapStyleEl = null;

    function injectMapStyles() {
        if (mapStyleEl) mapStyleEl.remove();
        const sz = getMapSize();
        const c = getThemeColors();
        mapStyleEl = document.createElement('style');
        mapStyleEl.textContent = `
            #monowe-minimap {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999998;
                width: ${sz.w}px;
                opacity: ${settings.opacity / 100};
                background: ${c.bg};
                border-radius: 12px;
                overflow: hidden;
                box-shadow: ${c.shadow};
                font-family: 'Segoe UI', system-ui, sans-serif;
                backdrop-filter: blur(12px);
                cursor: move;
                user-select: none;
                transition: opacity 0.2s ease;
            }
            #monowe-minimap:hover { opacity: 1 !important; }
            .monowe-map-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: ${c.headerBg};
                color: ${c.text};
                font-size: 0.8rem;
                letter-spacing: 0.05em;
            }
            .monowe-header-left {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                min-width: 0;
                flex: 1;
            }
            .monowe-header-right {
                display: flex;
                align-items: center;
                gap: 2px;
                flex-shrink: 0;
            }
            .monowe-loc-label {
                color: ${c.textDim};
                font-size: 0.75rem;
                white-space: nowrap;
            }
            .monowe-loc-name {
                color: ${c.locName};
                font-size: 0.78rem;
                font-weight: 600;
                display: inline-block;
                word-break: break-word;
                line-height: 1.3;
                cursor: pointer;
            }
            .monowe-loc-name:hover { text-decoration: underline; }
            .monowe-coords {
                color: ${c.textDim};
                font-size: 0.68rem;
                font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
                padding: 4px 12px;
                background: ${c.headerBg};
                border-top: 1px solid ${c.border};
                cursor: pointer;
                transition: color 0.15s;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .monowe-coords:hover { color: ${c.accent}; }
            .monowe-coords .copy-hint {
                margin-left: auto;
                font-size: 0.62rem;
                opacity: 0.6;
            }
            .monowe-map-header button {
                background: none;
                border: none;
                color: ${c.textDim};
                cursor: pointer;
                font-size: 1.1rem;
                padding: 0 4px;
                line-height: 1;
            }
            .monowe-map-header button:hover { color: ${c.btnHover}; }
            #monowe-map-body {
                height: ${sz.h}px;
                transition: height 0.3s ease;
            }
            #monowe-map-body.collapsed { height: 0; }
            #monowe-map-body .leaflet-container {
                width: 100%;
                height: 100%;
                background: #1a1a2e;
            }
            #monowe-map-body .leaflet-control-zoom a {
                background: rgba(18,18,18,0.9) !important;
                color: #00d4ff !important;
                border: 1px solid rgba(0,212,255,0.3) !important;
                width: 28px !important;
                height: 28px !important;
                line-height: 28px !important;
                font-size: 16px !important;
            }
            #monowe-map-body .leaflet-control-zoom a:hover {
                background: rgba(0,212,255,0.2) !important;
                color: #fff !important;
            }
            #monowe-minimap.hidden { display: none !important; }
        `;
        document.head.appendChild(mapStyleEl);
    }

    function applyTheme() {
        injectMapStyles();
    }

    function applySize() {
        const sz = getMapSize();
        const el = document.getElementById('monowe-minimap');
        if (!el) return;
        el.style.width = sz.w + 'px';
        const body = document.getElementById('monowe-map-body');
        if (body && !body.classList.contains('collapsed')) body.style.height = sz.h + 'px';
        if (mapObj && mapObj.map) setTimeout(() => mapObj.map.invalidateSize(), 350);
    }

    function toggleMinimap() {
        const el = document.getElementById('monowe-minimap');
        if (!el) return;
        el.classList.toggle('hidden');
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied!');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showToast('Copied!');
        });
    }

    function showToast(msg) {
        const existing = document.getElementById('monowe-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'monowe-toast';
        toast.textContent = msg;
        toast.style.cssText = `
            position: fixed; bottom: 80px; right: 20px; z-index: 9999999;
            background: rgba(0,212,255,0.9); color: #000;
            padding: 6px 14px; border-radius: 8px; font-size: 0.75rem;
            font-family: 'Segoe UI', system-ui, sans-serif; font-weight: 600;
            animation: monowe-toast-in 0.2s ease;
            box-shadow: 0 2px 12px rgba(0,212,255,0.3);
        `;
        const style = document.createElement('style');
        style.textContent = `@keyframes monowe-toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`;
        document.head.appendChild(style);
        document.body.appendChild(toast);
        setTimeout(() => { toast.remove(); style.remove(); }, 1500);
    }

    function toggleSettingsPanel() {
        let panel = document.getElementById('monowe-settings-panel');
        if (panel) { panel.remove(); return; }
        const c = getThemeColors();
        panel = document.createElement('div');
        panel.id = 'monowe-settings-panel';
        panel.innerHTML = `
            <div class="monowe-settings-title">Settings</div>
            <div class="monowe-settings-row">
                <span>Size</span>
                <div class="monowe-size-btns">
                    <button data-size="small" class="${settings.size === 'small' ? 'active' : ''}">S</button>
                    <button data-size="medium" class="${settings.size === 'medium' ? 'active' : ''}">M</button>
                    <button data-size="large" class="${settings.size === 'large' ? 'active' : ''}">L</button>
                </div>
            </div>
            <div class="monowe-settings-row">
                <span>Theme</span>
                <div class="monowe-theme-toggle">
                    <button data-theme="dark" class="${settings.theme === 'dark' ? 'active' : ''}">Dark</button>
                    <button data-theme="light" class="${settings.theme === 'light' ? 'active' : ''}">Light</button>
                </div>
            </div>
            <div class="monowe-settings-row">
                <span>Opacity</span>
                <input type="range" min="30" max="100" value="${settings.opacity}" data-setting="opacity"
                    style="width:80px;accent-color:${c.accent}">
            </div>
            <div class="monowe-settings-row">
                <span>Welcome</span>
                <button data-setting="showWelcome" class="${settings.showWelcome ? 'active' : ''}"
                    style="min-width:50px">${settings.showWelcome ? 'On' : 'Off'}</button>
            </div>
            <div class="monowe-settings-row">
                <span>Hotkey</span>
                <span style="color:${c.accent};font-size:0.72rem;font-family:monospace">${settings.hotkey.replace('Key','')}</span>
            </div>
        `;
        document.body.appendChild(panel);

        const minimap = document.getElementById('monowe-minimap');
        const rect = minimap.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        panel.style.right = (window.innerWidth - rect.right) + 'px';

        Object.assign(panel.style, {
            background: c.bg, borderRadius: '10px', padding: '12px 14px',
            zIndex: '999999', boxShadow: c.shadow,
            fontFamily: "'Segoe UI', system-ui, sans-serif", color: c.text, minWidth: '180px',
        });
        panel.querySelector('.monowe-settings-title').style.cssText =
            'font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;color:' + c.textDim;
        panel.querySelectorAll('.monowe-settings-row').forEach(r => {
            r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.78rem;';
        });
        panel.querySelectorAll('.monowe-settings-row > span').forEach(s => s.style.color = c.textDim);
        panel.querySelectorAll('.monowe-size-btns, .monowe-theme-toggle').forEach(g => {
            g.style.cssText = 'display:flex;gap:4px;';
        });
        panel.querySelectorAll('button').forEach(b => {
            if (b.dataset.setting === 'showWelcome') {
                b.style.cssText = `background:${c.headerBg};border:1px solid ${c.border};color:${c.textDim};border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.72rem;font-family:inherit;transition:all 0.15s;`;
                b.addEventListener('mouseenter', () => { b.style.color = c.text; b.style.borderColor = c.accent; });
                b.addEventListener('mouseleave', () => { if (!b.classList.contains('active')) { b.style.color = c.textDim; b.style.borderColor = c.border; }});
                if (b.classList.contains('active')) {
                    b.style.background = c.accent;
                    b.style.color = settings.theme === 'light' ? '#fff' : '#000';
                    b.style.borderColor = c.accent;
                }
            } else {
                b.style.cssText = `background:${c.headerBg};border:1px solid ${c.border};color:${c.textDim};border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.72rem;font-family:inherit;transition:all 0.15s;`;
                b.addEventListener('mouseenter', () => { b.style.color = c.text; b.style.borderColor = c.accent; });
                b.addEventListener('mouseleave', () => { if (!b.classList.contains('active')) { b.style.color = c.textDim; b.style.borderColor = c.border; }});
                if (b.classList.contains('active')) {
                    b.style.background = c.accent;
                    b.style.color = settings.theme === 'light' ? '#fff' : '#000';
                    b.style.borderColor = c.accent;
                }
            }
        });

        panel.querySelectorAll('[data-size]').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.size = btn.dataset.size;
                saveSettings();
                applySize();
                injectMapStyles();
                panel.remove();
                toggleSettingsPanel();
            });
        });
        panel.querySelectorAll('[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => {
                settings.theme = btn.dataset.theme;
                saveSettings();
                applyTheme();
                panel.remove();
                toggleSettingsPanel();
            });
        });
        const opacityInput = panel.querySelector('[data-setting="opacity"]');
        if (opacityInput) {
            opacityInput.addEventListener('input', () => {
                settings.opacity = parseInt(opacityInput.value);
                saveSettings();
                const el = document.getElementById('monowe-minimap');
                if (el) el.style.opacity = settings.opacity / 100;
            });
        }
        const welcomeBtn = panel.querySelector('[data-setting="showWelcome"]');
        if (welcomeBtn) {
            welcomeBtn.addEventListener('click', () => {
                settings.showWelcome = !settings.showWelcome;
                saveSettings();
                panel.remove();
                toggleSettingsPanel();
            });
        }

        setTimeout(() => {
            const handler = (e) => {
                if (!panel.contains(e.target) && !e.target.closest('#monowe-settings-btn')) {
                    panel.remove();
                    document.removeEventListener('mousedown', handler);
                }
            };
            document.addEventListener('mousedown', handler);
        }, 50);
    }

    function createMiniMap() {
        const sz = getMapSize();
        const c = getThemeColors();
        const container = document.createElement('div');
        container.id = 'monowe-minimap';
        container.innerHTML = `
            <div class="monowe-map-header">
                <div class="monowe-header-left">
                    <span class="monowe-loc-label">Location:</span>
                    <span id="monowe-location-name" class="monowe-loc-name" title="Click to copy">...</span>
                </div>
                <div class="monowe-header-right">
                    <button id="monowe-settings-btn" title="Settings">\u2699</button>
                    <button id="monowe-map-toggle" title="Toggle map">\u2212</button>
                </div>
            </div>
            <div id="monowe-coords-bar" class="monowe-coords" title="Click to copy coordinates">
                <span id="monowe-coords-text">--</span>
                <span class="copy-hint">click to copy</span>
            </div>
            <div id="monowe-map-body"></div>
        `;
        document.body.appendChild(container);

        injectMapStyles();

        const toggleBtn = document.getElementById('monowe-map-toggle');
        const settingsBtn = document.getElementById('monowe-settings-btn');
        const mapBody = document.getElementById('monowe-map-body');
        const coordsBar = document.getElementById('monowe-coords-bar');
        const locName = document.getElementById('monowe-location-name');

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const collapsed = mapBody.classList.toggle('collapsed');
            const coordsEl = document.getElementById('monowe-coords-bar');
            if (coordsEl) coordsEl.style.display = collapsed ? 'none' : '';
            toggleBtn.textContent = collapsed ? '+' : '\u2212';
            if (!collapsed) applySize();
        });

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSettingsPanel();
        });

        coordsBar.addEventListener('click', (e) => {
            e.stopPropagation();
            const coordsText = document.getElementById('monowe-coords-text');
            if (coordsText && lastCoords) {
                copyToClipboard(lastCoords.lat.toFixed(6) + ', ' + lastCoords.lng.toFixed(6));
            }
        });

        locName.addEventListener('click', (e) => {
            e.stopPropagation();
            if (lastCoords) {
                copyToClipboard(lastCoords.lat.toFixed(6) + ', ' + lastCoords.lng.toFixed(6));
            }
        });

        let isDragging = false, offsetX, offsetY;
        container.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('.monowe-coords')) return;
            isDragging = true;
            offsetX = e.clientX - container.getBoundingClientRect().left;
            offsetY = e.clientY - container.getBoundingClientRect().top;
            container.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            container.style.left = (e.clientX - offsetX) + 'px';
            container.style.top = (e.clientY - offsetY) + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                container.style.transition = '';
            }
        });

        return container;
    }

    // ─── MAP INITIALIZATION ──────────────────────────────────────
    function waitForLeaflet() {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (window.L) { clearInterval(check); resolve(); }
            }, 200);
        });
    }

    async function initLeafletMap() {
        await waitForLeaflet();
        const map = L.map('monowe-map-body', {
            zoomControl: true,
            attributionControl: false,
        }).setView([20, 0], 5);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap',
        }).addTo(map);

        const marker = L.circleMarker([0, 0], {
            radius: 8,
            color: '#00d4ff',
            fillColor: '#00d4ff',
            fillOpacity: 0.8,
            weight: 2,
        }).addTo(map);

        return { map, marker };
    }

    function updateMap(mapObj, coords) {
        if (!mapObj || !coords) return;
        const latlng = [coords.lat, coords.lng];
        mapObj.marker.setLatLng(latlng);
        mapObj.map.setView(latlng, 12, { animate: true, duration: 0.8 });

        const coordsText = document.getElementById('monowe-coords-text');
        if (coordsText) coordsText.textContent = coords.lat.toFixed(6) + ', ' + coords.lng.toFixed(6);
    }

    // ─── REVERSE GEOCODING ───────────────────────────────────────
    let geocodeTimer = null;
    let lastGeocoded = null;

    async function reverseGeocode(lat, lng) {
        const key = lat.toFixed(3) + ',' + lng.toFixed(3);
        if (key === lastGeocoded) return;
        lastGeocoded = key;

        try {
            const resp = await fetch(
                'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=10&accept-language=en',
                { headers: { 'User-Agent': 'monowe-openguessr/2.0' } }
            );
            const data = await resp.json();
            const el = document.getElementById('monowe-location-name');
            if (!el) return;

            const addr = data.address || {};
            const city = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || '';
            const country = addr.country || '';
            const region = addr.state || addr.region || '';

            let label = city || region || country || (data.display_name || '').split(',').slice(0, 2).join(', ') || '...';
            if (city && country && city !== country) label = city + ', ' + country;
            else if (region && country && region !== country) label = region + ', ' + country;

            el.textContent = label;
            el.title = (data.display_name || '') + '\nClick to copy coordinates';
        } catch (e) {
            console.log('[monowe] geocode error:', e);
        }
    }

    // ─── HOTKEY ──────────────────────────────────────────────────
    function setupHotkey() {
        document.addEventListener('keydown', (e) => {
            if (e.code === settings.hotkey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
                e.preventDefault();
                toggleMinimap();
            }
        });
    }

    // ─── MAIN ────────────────────────────────────────────────────
    let mapObj = null;

    async function main() {
        console.log('[monowe] script starting... v2.0');

        listeners.push((coords) => {
            if (mapObj) updateMap(mapObj, coords);
            clearTimeout(geocodeTimer);
            geocodeTimer = setTimeout(() => reverseGeocode(coords.lat, coords.lng), 300);
        });

        hookNetwork();
        hookJSONP();
        hookIframes();
        hookGoogleMapsAPI();
        setupHotkey();

        await showWelcomeAnimation();

        createMiniMap();
        mapObj = await initLeafletMap();
        console.log('[monowe] minimap ready');

        if (lastCoords) {
            console.log('[monowe] applying early coords:', lastCoords.lat, lastCoords.lng);
            updateMap(mapObj, lastCoords);
            reverseGeocode(lastCoords.lat, lastCoords.lng);
        }

        scanPageHTML();
        setTimeout(scanPageHTML, 3000);
        setTimeout(scanPageHTML, 6000);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        document.addEventListener('DOMContentLoaded', main);
    }
})();

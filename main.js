// ==UserScript==
// @name         OpenGuessr cheat v2.0
// @namespace    monowe
// @version      16.0
// @description  Improved location hack/cheat with better error handling and performance
// @match        https://www.openguessr.com/*
// @match        https://openguessr.com/*
// @grant        none
// @run-at       document-start
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/578787/OpenGuessr%20cheat%20v20.user.js
// @updateURL https://update.greasyfork.org/scripts/578787/OpenGuessr%20cheat%20v20.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIG ──────────────────────────────────────────────────
    const DEBUG = true;
    const debugLogs = [];
    const MAX_LOGS = 500;

    function log(...args) {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        const entry = { time: new Date().toLocaleTimeString(), msg };
        debugLogs.push(entry);
        if (debugLogs.length > MAX_LOGS) debugLogs.shift();
        console.log('[monowe]', ...args);
        updateDebugConsole();
    }

    const ANIMATION_DURATION = 2500;
    const MAP_SIZES = {
        tiny:   { w: 180, h: 130 },
        small:  { w: 220, h: 160 },
        medium: { w: 280, h: 220 },
        large:  { w: 380, h: 300 },
        xlarge: { w: 480, h: 380 },
        huge:   { w: 600, h: 480 },
    };
    const SETTINGS_KEY = 'monowe-settings';
    const HISTORY_KEY = 'monowe-history';
    const defaults = {
        size: 'medium', theme: 'dark', opacity: 95, showWelcome: true, hotkey: 'KeyM',
        mapProvider: 'osm', coordFormat: 'decimal',
        compactMode: false, autoHide: false, autoHideDelay: 10,
        showCountry: true, showWikipedia: true,
    };
    let settings = { ...defaults };
    const isFirstRun = !localStorage.getItem(SETTINGS_KEY);
    try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
    if (isFirstRun) { settings.mapProvider = 'osm'; saveSettings(); }
    function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    function getMapSize() { return MAP_SIZES[settings.size] || MAP_SIZES.medium; }

    // ─── LOCATION HISTORY ────────────────────────────────────────
    let locationHistory = [];
    try { locationHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
    const MAX_HISTORY = 50;
    function saveHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(locationHistory.slice(-MAX_HISTORY))); }
    function addToHistory(lat, lng, name, country) {
        const entry = { lat, lng, name: name || '...', country: country || '', time: Date.now() };
        locationHistory.push(entry);
        if (locationHistory.length > MAX_HISTORY) locationHistory.shift();
        saveHistory();
    }

    // ─── UTILITIES ───────────────────────────────────────────────
    function throttle(fn, ms) {
        let last = 0;
        return function (...args) {
            const now = Date.now();
            if (now - last >= ms) {
                last = now;
                return fn.apply(this, args);
            }
        };
    }

    function isValidCoord(lat, lng) {
        return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    }

    // ─── COORDINATE FORMATS ──────────────────────────────────────
    function toDMS(lat, lng) {
        const dms = (val, pos, neg) => {
            const abs = Math.abs(val);
            const d = Math.floor(abs);
            const m = Math.floor((abs - d) * 60);
            const s = ((abs - d - m/60) * 3600).toFixed(1);
            return `${d}°${String(m).padStart(2,'0')}'${String(s).padStart(5,'0')}"${val >= 0 ? pos : neg}`;
        };
        return dms(lat, 'N', 'S') + ' ' + dms(lng, 'E', 'W');
    }

    function toGoogleMapsLink(lat, lng) {
        return `https://www.google.com/maps/@${lat},${lng},15z`;
    }

    function toOSMLink(lat, lng) {
        return `https://www.openstreetmap.org/#map=15/${lat}/${lng}`;
    }

    function toYandexLink(lat, lng) {
        return `https://yandex.com/maps/?ll=${lng},${lat}&z=15&pt=${lng},${lat},pm2rdm`;
    }

    function formatCoord(lat, lng) {
        switch (settings.coordFormat) {
            case 'dms': return toDMS(lat, lng);
            case 'google': return toGoogleMapsLink(lat, lng);
            case 'osm': return toOSMLink(lat, lng);
            case 'yandex': return toYandexLink(lat, lng);
            default: return lat.toFixed(6) + ', ' + lng.toFixed(6);
        }
    }

    function getCountryFlag(countryCode) {
        if (!countryCode || countryCode.length !== 2) return '';
        const code = countryCode.toUpperCase();
        return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
    }

    function getWikipediaLink(name, country) {
        const q = encodeURIComponent(name + (country ? ' ' + country : ''));
        return `https://en.wikipedia.org/wiki/Special:Search?search=${q}`;
    }

    // ─── MAP PROVIDERS ───────────────────────────────────────────
    const MAP_PROVIDERS = {
        osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© OpenStreetMap' },
        osmDark: { name: 'OSM Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', maxZoom: 19, attribution: '© CartoDB', subdomains: 'abcd' },
        osmLight: { name: 'OSM Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', maxZoom: 19, attribution: '© CartoDB', subdomains: 'abcd' },
        satellite: { name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, attribution: '© Esri' },
        terrain: { name: 'Terrain', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attribution: '© OpenTopoMap' },
    };

    // ─── COUNTRY FLAGS ───────────────────────────────────────────
    const COUNTRY_CODES = {
        'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Argentina':'AR','Armenia':'AM',
        'Australia':'AU','Austria':'AT','Azerbaijan':'AZ','Bangladesh':'BD','Belarus':'BY',
        'Belgium':'BE','Bolivia':'BO','Brazil':'BR','Bulgaria':'BG','Cambodia':'KH',
        'Cameroon':'CM','Canada':'CA','Chile':'CL','China':'CN','Colombia':'CO',
        'Costa Rica':'CR','Croatia':'HR','Cuba':'CU','Czech Republic':'CZ','Denmark':'DK',
        'Ecuador':'EC','Egypt':'EG','Estonia':'EE','Ethiopia':'ET','Finland':'FI',
        'France':'FR','Germany':'DE','Ghana':'GH','Greece':'GR','Guatemala':'GT',
        'Honduras':'HN','Hungary':'HU','Iceland':'IS','India':'IN','Indonesia':'ID',
        'Iran':'IR','Iraq':'IQ','Ireland':'IE','Israel':'IL','Italy':'IT',
        'Jamaica':'JM','Japan':'JP','Jordan':'JO','Kazakhstan':'KZ','Kenya':'KE',
        'Kuwait':'KW','Latvia':'LV','Lithuania':'LT','Luxembourg':'LU','Madagascar':'MG',
        'Malaysia':'MY','Mexico':'MX','Morocco':'MA','Nepal':'NP','Netherlands':'NL',
        'New Zealand':'NZ','Nigeria':'NG','Norway':'NO','Pakistan':'PK','Panama':'PA',
        'Paraguay':'PY','Peru':'PE','Philippines':'PH','Poland':'PL','Portugal':'PT',
        'Romania':'RO','Russia':'RU','Saudi Arabia':'SA','Serbia':'RS','Singapore':'SG',
        'Slovakia':'SK','Slovenia':'SI','South Africa':'ZA','South Korea':'KR','Spain':'ES',
        'Sri Lanka':'LK','Sweden':'SE','Switzerland':'CH','Taiwan':'TW','Thailand':'TH',
        'Tunisia':'TN','Turkey':'TR','UAE':'AE','Ukraine':'UA','United Kingdom':'GB',
        'United States':'US','Uruguay':'UY','Uzbekistan':'UZ','Venezuela':'VE','Vietnam':'VN',
    };

    // ─── CLEANUP SYSTEM ──────────────────────────────────────────
    const cleanupFns = [];
    const intervals = [];

    function trackInterval(fn, ms) {
        const id = setInterval(fn, ms);
        intervals.push(id);
        return id;
    }

    function cleanupAll() {
        for (const fn of cleanupFns) {
            try { fn(); } catch (e) { log('cleanup error:', e); }
        }
        for (const id of intervals) clearInterval(id);
        intervals.length = 0;
    }

    window.addEventListener('beforeunload', cleanupAll);

    // ─── LOAD LEAFLET ────────────────────────────────────────────
    function loadLeaflet() {
        return new Promise((resolve, reject) => {
            if (window.L) { resolve(); return; }

            const leafletCSS = document.createElement('link');
            leafletCSS.rel = 'stylesheet';
            leafletCSS.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            (document.head || document.documentElement).appendChild(leafletCSS);

            const leafletJS = document.createElement('script');
            leafletJS.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            leafletJS.onload = resolve;
            leafletJS.onerror = () => reject(new Error('Failed to load Leaflet'));
            (document.head || document.documentElement).appendChild(leafletJS);

            // Timeout fallback
            setTimeout(() => {
                if (!window.L) reject(new Error('Leaflet load timeout'));
            }, 10000);
        });
    }

    // ─── COORDINATE SYSTEM ───────────────────────────────────────
    const listeners = [];
    let lastCoords = null;

    function emitCoords(coords) {
        if (!coords || !isValidCoord(coords.lat, coords.lng)) return;
        if (lastCoords && lastCoords.lat === coords.lat && lastCoords.lng === coords.lng) return;
        lastCoords = coords;
        log('coords found:', coords.lat, coords.lng);
        for (const fn of listeners) {
            try { fn(coords); } catch (e) { log('listener error:', e); }
        }
    }

    // ─── METHOD 1: Hook Google Maps API ──────────────────────────
    function hookGoogleMapsAPI() {
        const check = trackInterval(() => {
            if (!window.google || !window.google.maps) return;
            clearInterval(check);

            log('Google Maps API detected, hooking...');
            const SVP = window.google.maps.StreetViewPanorama;
            if (!SVP) return;

            const instances = new Set();

            const handler = {
                construct(target, args) {
                    const instance = new target(...args);
                    instances.add(instance);
                    hookInstance(instance);
                    setTimeout(() => readPosition(instance), 500);
                    return instance;
                }
            };
            const proxied = new Proxy(SVP, handler);
            window.google.maps.StreetViewPanorama = proxied;
            proxied.prototype = SVP.prototype;

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
                } catch (e) { log('scanExisting error:', e); }
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
                } catch (e) { log('readPosition error:', e); }
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

            trackInterval(() => {
                scanExisting();
                for (const pano of instances) readPosition(pano);
            }, 2000);

            scanExisting();
            for (const pano of instances) readPosition(pano);
        }, 500);
    }

    // ─── METHOD 2: Intercept fetch/XHR ───────────────────────────
    function hookNetwork() {
        const coordPatterns = [
            /"(?:lat(?:itude)?|y)"\s*:\s*(-?\d+\.?\d*)\s*,\s*"(?:l(?:on|ng)(?:g(?:itude)?|)|x)"\s*:\s*(-?\d+\.?\d*)/i,
            /"(?:l(?:on|ng)(?:g(?:itude)?|)|x)"\s*:\s*(-?\d+\.?\d*)\s*,\s*"(?:lat(?:itude)?|y)"\s*:\s*(-?\d+\.?\d*)/i,
            /"lat"\s*:\s*(-?\d+\.?\d*)\s*,\s*"lon"\s*:\s*(-?\d+\.?\d*)/i,
            /"latitude"\s*:\s*(-?\d+\.?\d*)\s*,\s*"longitude"\s*:\s*(-?\d+\.?\d*)/i,
        ];

        function extractCoords(text) {
            for (const re of coordPatterns) {
                const m = text.match(re);
                if (m) {
                    const a = parseFloat(m[1]), b = parseFloat(m[2]);
                    if (isValidCoord(a, b)) return { lat: a, lng: b };
                }
            }
            return null;
        }

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
            let [url, opts] = args;
            const urlStr = typeof url === 'string' ? url : (url instanceof Request ? url.url : String(url));
            const method = opts?.method || (url instanceof Request ? url.method : 'GET');
            const bodyRaw = opts?.body || (url instanceof Request ? url.body : null);

            log('fetch:', method, urlStr.substring(0, 120));

            // Show ALL bodies for debugging
            if (bodyRaw) {
                let bodyStr = '';
                if (typeof bodyRaw === 'string') bodyStr = bodyRaw;
                else if (bodyRaw instanceof URLSearchParams) bodyStr = bodyRaw.toString();
                else if (bodyRaw instanceof ArrayBuffer) bodyStr = '(arraybuffer ' + bodyRaw.byteLength + ')';
                else bodyStr = '(' + typeof bodyRaw + ')';

                if (bodyStr.length > 0 && !bodyStr.startsWith('(')) {
                    log('fetch body:', bodyStr.substring(0, 300));
                }
            }

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
            this._mMethod = m;
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

        trackInterval(scanGlobalScope, 3000);

        cleanupFns.push(() => {
            Node.prototype.appendChild = origAppendChild;
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
            const ll = url.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (ll) emitCoords({ lat: parseFloat(ll[1]), lng: parseFloat(ll[2]) });
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
            /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
            /"lat"\s*:\s*(-?\d+\.?\d*)\s*,\s*"lng"\s*:\s*(-?\d+\.?\d*)/,
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m) {
                const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
                if (isValidCoord(lat, lng)) {
                    emitCoords({ lat, lng });
                    return;
                }
            }
        }
    }

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
            #monowe-minimap.error-state {
                display: flex;
                align-items: center;
                justify-content: center;
                height: auto;
                min-height: 60px;
                padding: 12px;
                text-align: center;
                color: ${c.textDim};
                font-size: 0.75rem;
            }
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
        // Update settings panel position
        repositionSettingsPanel();
    }

    function repositionSettingsPanel() {
        const panel = document.getElementById('monowe-settings-panel');
        const minimap = document.getElementById('monowe-minimap');
        if (!panel || !minimap) return;
        const rect = minimap.getBoundingClientRect();
        const panelHeight = 400;
        const spaceAbove = rect.top;
        if (spaceAbove > panelHeight + 10) {
            panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
            panel.style.top = '';
        } else {
            panel.style.top = (rect.bottom + 8) + 'px';
            panel.style.bottom = '';
        }
        panel.style.right = (window.innerWidth - rect.right) + 'px';
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
                    <button data-size="tiny" class="${settings.size === 'tiny' ? 'active' : ''}">XS</button>
                    <button data-size="small" class="${settings.size === 'small' ? 'active' : ''}">S</button>
                    <button data-size="medium" class="${settings.size === 'medium' ? 'active' : ''}">M</button>
                    <button data-size="large" class="${settings.size === 'large' ? 'active' : ''}">L</button>
                    <button data-size="xlarge" class="${settings.size === 'xlarge' ? 'active' : ''}">XL</button>
                    <button data-size="huge" class="${settings.size === 'huge' ? 'active' : ''}">XXL</button>
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
                <span>Map</span>
                <select data-setting="mapProvider" style="background:${c.headerBg};color:${c.text};border:1px solid ${c.border};border-radius:6px;padding:3px 6px;font-size:0.72rem;font-family:inherit;">
                    ${Object.entries(MAP_PROVIDERS).map(([k, v]) => `<option value="${k}" ${settings.mapProvider === k ? 'selected' : ''}>${v.name}</option>`).join('')}
                </select>
            </div>
            <div class="monowe-settings-row">
                <span>Coords</span>
                <select data-setting="coordFormat" style="background:${c.headerBg};color:${c.text};border:1px solid ${c.border};border-radius:6px;padding:3px 6px;font-size:0.72rem;font-family:inherit;">
                    <option value="decimal" ${settings.coordFormat === 'decimal' ? 'selected' : ''}>Decimal</option>
                    <option value="dms" ${settings.coordFormat === 'dms' ? 'selected' : ''}>DMS</option>
                    <option value="google" ${settings.coordFormat === 'google' ? 'selected' : ''}>Google Maps</option>
                    <option value="osm" ${settings.coordFormat === 'osm' ? 'selected' : ''}>OpenStreetMap</option>
                    <option value="yandex" ${settings.coordFormat === 'yandex' ? 'selected' : ''}>Yandex Maps</option>
                </select>
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
                <span>Country Flag</span>
                <button data-setting="showCountry" class="${settings.showCountry ? 'active' : ''}"
                    style="min-width:50px">${settings.showCountry ? 'On' : 'Off'}</button>
            </div>
            <div class="monowe-settings-row">
                <span>Compact</span>
                <button data-setting="compactMode" class="${settings.compactMode ? 'active' : ''}"
                    style="min-width:50px">${settings.compactMode ? 'On' : 'Off'}</button>
            </div>
            <div class="monowe-settings-row">
                <span>History</span>
                <button id="monowe-show-history" style="background:${c.headerBg};border:1px solid ${c.border};color:${c.accent};border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.72rem;">${locationHistory.length} locations</button>
            </div>
            <div class="monowe-settings-row">
                <span>Hotkey</span>
                <span style="color:${c.accent};font-size:0.72rem;font-family:monospace">${settings.hotkey.replace('Key','')}</span>
            </div>
            <div style="height:1px;background:${c.border};margin:8px 0;"></div>
            <div class="monowe-settings-row">
                <span>Reset</span>
                <button id="monowe-reset-settings" style="background:rgba(255,100,100,0.15);border:1px solid rgba(255,100,100,0.3);color:#ff6b6b;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:0.72rem;">Reset All</button>
            </div>
        `;
        document.body.appendChild(panel);

        const minimap = document.getElementById('monowe-minimap');
        const rect = minimap.getBoundingClientRect();
        panel.style.position = 'fixed';
        // Position above minimap, but if not enough space, position below
        const panelHeight = 400; // approximate
        const spaceAbove = rect.top;
        if (spaceAbove > panelHeight + 10) {
            panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        } else {
            panel.style.top = (rect.bottom + 8) + 'px';
        }
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
            b.style.cssText = `background:${c.headerBg};border:1px solid ${c.border};color:${c.textDim};border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.68rem;font-family:inherit;transition:all 0.15s;min-width:32px;text-align:center;`;
            b.addEventListener('mouseenter', () => { b.style.color = c.text; b.style.borderColor = c.accent; });
            b.addEventListener('mouseleave', () => { if (!b.classList.contains('active')) { b.style.color = c.textDim; b.style.borderColor = c.border; }});
            if (b.classList.contains('active')) {
                b.style.background = c.accent;
                b.style.color = settings.theme === 'light' ? '#fff' : '#000';
                b.style.borderColor = c.accent;
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
        const countryBtn = panel.querySelector('[data-setting="showCountry"]');
        if (countryBtn) {
            countryBtn.addEventListener('click', () => {
                settings.showCountry = !settings.showCountry;
                saveSettings();
                panel.remove();
                toggleSettingsPanel();
            });
        }
        const compactBtn = panel.querySelector('[data-setting="compactMode"]');
        if (compactBtn) {
            compactBtn.addEventListener('click', () => {
                settings.compactMode = !settings.compactMode;
                saveSettings();
                applyCompactMode();
                panel.remove();
                toggleSettingsPanel();
            });
        }
        const mapProviderSelect = panel.querySelector('[data-setting="mapProvider"]');
        if (mapProviderSelect) {
            mapProviderSelect.addEventListener('change', () => {
                settings.mapProvider = mapProviderSelect.value;
                saveSettings();
                panel.remove();
                toggleSettingsPanel();
                // Reload map with new provider
                if (mapObj && mapObj.map) {
                    mapObj.map.eachLayer(layer => { if (layer !== mapObj.marker) mapObj.map.removeLayer(layer); });
                    const provider = MAP_PROVIDERS[settings.mapProvider] || MAP_PROVIDERS.osm;
                    L.tileLayer(provider.url, { maxZoom: provider.maxZoom, attribution: provider.attribution, subdomains: provider.subdomains }).addTo(mapObj.map);
                }
            });
        }
        const coordFormatSelect = panel.querySelector('[data-setting="coordFormat"]');
        if (coordFormatSelect) {
            coordFormatSelect.addEventListener('change', () => {
                settings.coordFormat = coordFormatSelect.value;
                saveSettings();
                if (lastCoords) {
                    const coordsText = document.getElementById('monowe-coords-text');
                    if (coordsText) coordsText.textContent = formatCoord(lastCoords.lat, lastCoords.lng);
                }
            });
        }
        const historyBtn = panel.querySelector('#monowe-show-history');
        if (historyBtn) {
            historyBtn.addEventListener('click', () => {
                panel.remove();
                showHistoryPanel();
            });
        }
        const resetBtn = panel.querySelector('#monowe-reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Reset all settings to defaults?')) {
                    settings = { ...defaults };
                    saveSettings();
                    panel.remove();
                    toggleSettingsPanel();
                    showToast('Settings reset!');
                }
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

    function showHistoryPanel() {
        const c = getThemeColors();
        let panel = document.getElementById('monowe-history-panel');
        if (panel) { panel.remove(); return; }

        panel = document.createElement('div');
        panel.id = 'monowe-history-panel';
        panel.innerHTML = `
            <div id="monowe-history-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${c.headerBg};border-bottom:1px solid ${c.border};cursor:move;user-select:none;">
                <span style="font-size:0.75rem;color:${c.accent};font-weight:600;">Location History (${locationHistory.length})</span>
                <div style="display:flex;gap:4px;">
                    <button id="monowe-export-history" style="background:none;border:1px solid ${c.border};color:${c.accent};border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.65rem;">Export</button>
                    <button id="monowe-clear-history" style="background:none;border:1px solid ${c.border};color:#ff6b6b;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.65rem;">Clear</button>
                    <button id="monowe-close-history" style="background:none;border:none;color:${c.textDim};cursor:pointer;font-size:0.9rem;padding:0 4px;">&times;</button>
                </div>
            </div>
            <div id="monowe-history-list" style="max-height:300px;overflow-y:auto;padding:4px 0;"></div>
        `;
        Object.assign(panel.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '380px', background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: '10px', zIndex: '9999999', boxShadow: c.shadow,
            fontFamily: "'Segoe UI', system-ui, sans-serif", color: c.text,
        });
        document.body.appendChild(panel);

        // Make history panel draggable
        const header = panel.querySelector('#monowe-history-header');
        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel.style.transform = 'none';
            panel.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                panel.style.transition = '';
            }
        });

        const list = panel.querySelector('#monowe-history-list');
        if (locationHistory.length === 0) {
            list.innerHTML = `<div style="padding:20px;text-align:center;color:${c.textDim};font-size:0.75rem;">No history yet</div>`;
        } else {
            for (let i = locationHistory.length - 1; i >= 0; i--) {
                const h = locationHistory[i];
                const time = new Date(h.time).toLocaleString();
                const item = document.createElement('div');
                item.style.cssText = `padding:8px 12px;border-bottom:1px solid ${c.border};cursor:pointer;font-size:0.72rem;transition:background 0.15s;`;
                item.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:${c.text};">${(h.country ? getCountryFlag(COUNTRY_CODES[h.country] || '') + ' ' : '')}${h.name || 'Unknown'}</span>
                        <span style="color:${c.textDim};font-size:0.62rem;">${time}</span>
                    </div>
                    <div style="color:${c.textDim};font-size:0.65rem;font-family:monospace;margin-top:2px;">${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}</div>
                `;
                item.addEventListener('mouseenter', () => { item.style.background = c.headerBg; });
                item.addEventListener('mouseleave', () => { item.style.background = ''; });
                item.addEventListener('click', () => {
                    if (mapObj && mapObj.map) {
                        mapObj.map.setView([h.lat, h.lng], 12, { animate: true });
                        mapObj.marker.setLatLng([h.lat, h.lng]);
                    }
                    panel.remove();
                });
                list.appendChild(item);
            }
        }

        document.getElementById('monowe-close-history').addEventListener('click', () => panel.remove());
        document.getElementById('monowe-clear-history').addEventListener('click', () => {
            locationHistory = [];
            saveHistory();
            panel.remove();
        });
        document.getElementById('monowe-export-history').addEventListener('click', () => {
            const csv = 'lat,lng,name,country,time\n' + locationHistory.map(h =>
                `${h.lat},${h.lng},"${(h.name||'').replace(/"/g,'""')}","${h.country||''}",${new Date(h.time).toISOString()}`
            ).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'openguessr_history.csv'; a.click();
            URL.revokeObjectURL(url);
            showToast('History exported!');
        });
    }

    function applyCompactMode() {
        const el = document.getElementById('monowe-minimap');
        if (!el) return;
        const mapBody = document.getElementById('monowe-map-body');
        const coordsBar = document.getElementById('monowe-coords-bar');
        const header = el.querySelector('.monowe-map-header');
        if (settings.compactMode) {
            if (mapBody) mapBody.style.display = 'none';
            if (coordsBar) coordsBar.style.display = 'none';
            if (header) header.style.display = 'none';
            el.style.width = 'auto';
            el.style.minWidth = '120px';
            el.style.padding = '6px 10px';
            el.style.cursor = 'pointer';
        } else {
            if (mapBody) mapBody.style.display = '';
            if (coordsBar) coordsBar.style.display = '';
            if (header) header.style.display = '';
            el.style.width = '';
            el.style.minWidth = '';
            el.style.padding = '';
            el.style.cursor = 'move';
            applySize();
        }
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
                    <button id="monowe-settings-btn" title="Settings">&#9881;</button>
                    <button id="monowe-map-toggle" title="Toggle map">&#8722;</button>
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
            toggleBtn.textContent = collapsed ? '+' : '&#8722;';
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

    // ─── FALLBACK MAP ────────────────────────────────────────────
    function createFallbackMap(coords) {
        const c = getThemeColors();
        const container = document.getElementById('monowe-minimap');
        if (!container) return;

        container.classList.add('error-state');
        const mapBody = document.getElementById('monowe-map-body');
        if (mapBody) {
            mapBody.innerHTML = `
                <div style="padding:12px;text-align:center;">
                    <div style="color:${c.accent};font-size:0.8rem;margin-bottom:6px;">Map unavailable</div>
                    <div style="color:${c.textDim};font-size:0.7rem;">Leaflet failed to load</div>
                    ${coords ? `<div style="color:${c.text};font-size:0.7rem;margin-top:8px;font-family:monospace;">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</div>` : ''}
                </div>
            `;
        }
    }

    // ─── MAP INITIALIZATION ──────────────────────────────────────
    async function initLeafletMap() {
        try {
            await loadLeaflet();
        } catch (e) {
            log('Leaflet load failed:', e);
            createFallbackMap(lastCoords);
            return null;
        }

        try {
            const map = L.map('monowe-map-body', {
                zoomControl: true,
                attributionControl: false,
            }).setView([20, 0], 5);

            // Try selected provider, fallback to OSM
            let provider = MAP_PROVIDERS[settings.mapProvider] || MAP_PROVIDERS.osm;
            try {
                L.tileLayer(provider.url, {
                    maxZoom: provider.maxZoom,
                    attribution: provider.attribution,
                    subdomains: provider.subdomains || '',
                }).addTo(map);
            } catch (tileErr) {
                log('Tile layer failed, falling back to OSM:', tileErr);
                L.tileLayer(MAP_PROVIDERS.osm.url, {
                    maxZoom: MAP_PROVIDERS.osm.maxZoom,
                    attribution: MAP_PROVIDERS.osm.attribution,
                }).addTo(map);
            }

            const marker = L.circleMarker([0, 0], {
                radius: 8,
                color: '#00d4ff',
                fillColor: '#00d4ff',
                fillOpacity: 0.8,
                weight: 2,
            }).addTo(map);

            return { map, marker };
        } catch (e) {
            log('Map init failed:', e.message || e);
            createFallbackMap(lastCoords);
            return null;
        }
    }

    function updateMap(mapObj, coords) {
        if (!mapObj || !coords) return;
        const latlng = [coords.lat, coords.lng];
        mapObj.marker.setLatLng(latlng);
        mapObj.map.setView(latlng, 12, { animate: true, duration: 0.8 });

        const coordsText = document.getElementById('monowe-coords-text');
        if (coordsText) coordsText.textContent = formatCoord(coords.lat, coords.lng);
    }

    // ─── REVERSE GEOCODING ───────────────────────────────────────
    let lastGeocoded = null;

    const reverseGeocode = throttle(async (lat, lng) => {
        const key = lat.toFixed(3) + ',' + lng.toFixed(3);
        if (key === lastGeocoded) return;
        lastGeocoded = key;

        try {
            const resp = await fetch(
                'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=10&accept-language=en',
                { headers: { 'User-Agent': 'monowe-openguessr/3.0' } }
            );
            const data = await resp.json();
            const el = document.getElementById('monowe-location-name');
            if (!el) return;

            const addr = data.address || {};
            const city = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || '';
            const country = addr.country || '';
            const region = addr.state || addr.region || '';
            const countryCode = addr.country_code || '';

            let label = city || region || country || (data.display_name || '').split(',').slice(0, 2).join(', ') || '...';
            if (city && country && city !== country) label = city + ', ' + country;
            else if (region && country && region !== country) label = region + ', ' + country;

            // Add country flag
            if (settings.showCountry && countryCode) {
                const flag = getCountryFlag(countryCode);
                if (flag) label = flag + ' ' + label;
            }

            el.textContent = label;
            el.title = (data.display_name || '') + '\nClick to copy coordinates';

            // Save to history
            addToHistory(lat, lng, data.display_name || label, country);
        } catch (e) {
            log('geocode error:', e);
        }
    }, 1000);

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

    // ─── LEAFLET MAP INTERCEPT ────────────────────────────────────
    let gameMapInstance = null;

    function findButton(texts) {
        const buttons = document.querySelectorAll('button, .standard-button, [role="button"], div.confirm-button');
        for (const btn of buttons) {
            const btnText = (btn.textContent || '').toLowerCase().trim();
            for (const t of texts) {
                if (btnText.includes(t.toLowerCase())) return btn;
            }
        }
        return null;
    }

    // ─── INTERCEPT LEAFLET CLICK HANDLER ─────────────────────────
    // Hook L.map to capture game map instance
    function hookGameMap() {
        // Wait for Leaflet to load, then hook
        const check = setInterval(() => {
            if (!window.L || !window.L.map) return;
            clearInterval(check);

            log('hookGameMap: Leaflet loaded, hooking L.map...');

            const origMap = window.L.map;
            window.L.map = function (...args) {
                const map = origMap.apply(this, args);
                const container = map.getContainer();
                log('hookGameMap: L.map called, container:', container ? container.id : 'null');
                if (container && container.id === 'map') {
                    gameMapInstance = map;
                    log('hookGameMap: GAME MAP CAPTURED!');
                }
                return map;
            };
            window.L.map.prototype = origMap.prototype;

            // Also scan for already-created maps
            scanExistingMaps();
        }, 300);
    }

    function scanExistingMaps() {
        if (!window.L) return;

        // Method: scan all elements for Leaflet map instances
        const containers = document.querySelectorAll('.leaflet-container, #map');
        for (const container of containers) {
            if (container._leaflet_id !== undefined) {
                // Check all properties
                for (const key of Object.getOwnPropertyNames(container)) {
                    try {
                        const val = container[key];
                        if (val && typeof val === 'object' && typeof val.getCenter === 'function' && typeof val.getZoom === 'function') {
                            gameMapInstance = val;
                            log('scanExistingMaps: FOUND map on', container.id || container.className, 'prop:', key);
                            return;
                        }
                    } catch {}
                }

                // Check _leaflet_map on all children
                const children = container.querySelectorAll('*');
                for (const child of children) {
                    for (const key of Object.getOwnPropertyNames(child)) {
                        try {
                            if (key === '_leaflet_map') {
                                gameMapInstance = child[key];
                                log('scanExistingMaps: FOUND via _leaflet_map on child');
                                return;
                            }
                        } catch {}
                    }
                }
            }
        }

        // Method: check L namespace for any map-like objects
        for (const key of Object.keys(window.L)) {
            try {
                const val = window.L[key];
                if (val && typeof val === 'object' && typeof val.getCenter === 'function' && typeof val.getContainer === 'function') {
                    const c = val.getContainer();
                    if (c && (c.id === 'map' || c.classList.contains('leaflet-container'))) {
                        gameMapInstance = val;
                        log('scanExistingMaps: FOUND map via L.' + key);
                        return;
                    }
                }
            } catch {}
        }

        log('scanExistingMaps: no existing map found');
    }

    function scanForMapInstance(container) {
        if (!container) return null;

        // Method 1: Direct property scan
        for (const key of Object.getOwnPropertyNames(container)) {
            const val = container[key];
            if (val && typeof val === 'object' && typeof val.getCenter === 'function' && typeof val.getZoom === 'function') {
                gameMapInstance = val;
                log('found map via property:', key);
                return val;
            }
        }

        // Method 2: Check _leaflet properties
        for (const key of Object.keys(container)) {
            if (key.startsWith('_leaflet')) {
                const val = container[key];
                if (val && typeof val === 'object' && val._zoom !== undefined) {
                    gameMapInstance = val;
                    log('found map via _leaflet:', key);
                    return val;
                }
            }
        }

        // Method 3: Scan leaflet panes and controls
        const elements = container.querySelectorAll('.leaflet-pane, .leaflet-control, .leaflet-tile-pane, .leaflet-overlay-pane, .leaflet-marker-pane');
        for (const el of elements) {
            for (const key of Object.getOwnPropertyNames(el)) {
                try {
                    const val = el[key];
                    if (val && typeof val === 'object' && typeof val.getCenter === 'function' && typeof val.getZoom === 'function') {
                        gameMapInstance = val;
                        log('found map via element:', el.className, key);
                        return val;
                    }
                    // Also check for _map property (Leaflet stores map ref on layers)
                    if (val && typeof val === 'object' && val._map && typeof val._map.getCenter === 'function') {
                        gameMapInstance = val._map;
                        log('found map via _map on:', el.className, key);
                        return val._map;
                    }
                } catch {}
            }
        }

        // Method 4: Access through L's internal stores
        if (window.L && container._leaflet_id !== undefined) {
            if (window.L.Map && window.L.Map._maps) {
                const map = window.L.Map._maps[container._leaflet_id];
                if (map) {
                    gameMapInstance = map;
                    log('found map via L.Map._maps');
                    return map;
                }
            }

            // Check L._maps directly
            if (window.L._maps) {
                for (const key in window.L._maps) {
                    const m = window.L._maps[key];
                    if (m && m.getContainer && m.getContainer() === container) {
                        gameMapInstance = m;
                        log('found map via L._maps');
                        return m;
                    }
                }
            }

            // Scan ALL elements inside map for _leaflet_map references
            const allEls = container.querySelectorAll('*');
            for (const el of allEls) {
                for (const key of Object.getOwnPropertyNames(el)) {
                    try {
                        if (key === '_leaflet_map' || (key.startsWith('_leaflet') && el[key] && typeof el[key].getCenter === 'function')) {
                            gameMapInstance = el[key];
                            log('found map via deep scan:', el.tagName, key);
                            return el[key];
                        }
                    } catch {}
                }
            }
        }

        // Method 5: Hook via event listeners
        if (window.L && window.L.DomEvent && window.L.DomEvent._map) {
            gameMapInstance = window.L.DomEvent._map;
            log('found map via L.DomEvent._map');
            return window.L.DomEvent._map;
        }

        return null;
    }

    function findGameMap() {
        log('findGameMap: searching...');
        if (gameMapInstance) {
            try {
                const center = gameMapInstance.getCenter();
                log('findGameMap: cached map valid, center:', center.lat.toFixed(4), center.lng.toFixed(4));
                return gameMapInstance;
            } catch (e) {
                log('findGameMap: cached map invalid');
                gameMapInstance = null;
            }
        }

        // Try scanning for maps
        scanExistingMaps();
        if (gameMapInstance) {
            log('findGameMap: found via scanExistingMaps');
            return gameMapInstance;
        }

        const mapEl = document.getElementById('map');
        if (!mapEl) {
            log('findGameMap: #map NOT FOUND');
            return null;
        }
        log('findGameMap: #map found, _leaflet_id:', mapEl._leaflet_id);

        // Try property scan
        const found = scanForMapInstance(mapEl);
        if (found) return found;

        // Method: iterate window properties
        log('searching window properties...');
        const windowKeys = Object.getOwnPropertyNames(window);
        log('window properties count:', windowKeys.length);

        for (const key of windowKeys) {
            try {
                const val = window[key];
                if (val && typeof val === 'object' && typeof val.getCenter === 'function' && typeof val.getZoom === 'function') {
                    const container = val.getContainer ? val.getContainer() : null;
                    if (container && container.id === 'map') {
                        gameMapInstance = val;
                        log('findGameMap: FOUND via window.' + key);
                        return val;
                    }
                }
            } catch {}
        }

        // Method: scan document.querySelectorAll('*') for map-like objects
        log('scanning DOM elements...');
        const allElements = document.querySelectorAll('#map *, #map');
        for (const el of allElements) {
            for (const key of Object.getOwnPropertyNames(el)) {
                try {
                    const val = el[key];
                    if (val && typeof val === 'object' && typeof val.getCenter === 'function') {
                        gameMapInstance = val;
                        log('findGameMap: FOUND via DOM scan on', el.tagName, el.id, key);
                        return val;
                    }
                } catch {}
            }
        }

        log('findGameMap: NOT FOUND after all methods');
        return null;
    }

    function openGameMap() {
        log('openGameMap: looking for confirm-button...');
        const confirmBtn = document.getElementById('confirm-button');
        if (!confirmBtn) {
            log('openGameMap: confirm-button NOT FOUND');
            return false;
        }
        log('openGameMap: confirm-button found, text:', confirmBtn.textContent.trim());

        const mapHolder = document.getElementById('map-holder');
        const isMapVisible = mapHolder && mapHolder.offsetHeight > 0;
        log('openGameMap: map visible:', isMapVisible, 'height:', mapHolder ? mapHolder.offsetHeight : 'N/A');

        if (!isMapVisible) {
            log('openGameMap: clicking to open map');
            confirmBtn.click();
        } else {
            log('openGameMap: map already open');
        }
        return true;
    }

    function dispatchMapEvent(container, clientX, clientY, type) {
        const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        const useEvents = type === 'all' ? events : [type];

        for (const eventType of useEvents) {
            const EventClass = eventType.startsWith('pointer') ? PointerEvent : MouseEvent;
            const event = new EventClass(eventType, {
                clientX, clientY,
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                buttons: eventType.includes('down') ? 1 : 0,
                pointerId: 1,
                pointerType: 'mouse',
            });
            container.dispatchEvent(event);
        }
    }

    function clickGuessButton() {
        // Look for the confirm button that becomes "Guess" after marker is placed
        const confirmBtn = document.getElementById('confirm-button');
        if (confirmBtn) {
            const text = (confirmBtn.textContent || '').toLowerCase();
            if (text.includes('guess') || text.includes('submit') || text.includes('confirm')) {
                log('clicking guess button:', text.trim());
                confirmBtn.click();
                return true;
            }
        }

        // Search by text
        const guessBtn = findButton(['guess', 'submit', 'confirm']);
        if (guessBtn) {
            log('clicking guess button by text');
            guessBtn.click();
            return true;
        }

        return false;
    }

    function clickNextButton() {
        const nextBtn = findButton(['next', 'continue', 'new game', 'play again', 'new round', 'next round']);
        if (nextBtn) {
            log('clicking next button');
            nextBtn.click();
            return true;
        }
        return false;
    }

    // ─── DEBUG CONSOLE ───────────────────────────────────────────
    let debugConsoleVisible = false;

    function createDebugConsole() {
        const c = getThemeColors();
        const container = document.createElement('div');
        container.id = 'monowe-debug-console';
        container.innerHTML = `
            <div id="monowe-debug-header" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:${c.headerBg};border-bottom:1px solid ${c.border};cursor:move;user-select:none;">
                <span style="font-size:0.7rem;color:${c.accent};font-weight:600;">Debug Console (drag to move)</span>
                <div style="display:flex;gap:4px;">
                    <button id="monowe-debug-clear" style="background:none;border:1px solid ${c.border};color:${c.textDim};border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.6rem;">Clear</button>
                    <button id="monowe-debug-close" style="background:none;border:none;color:${c.textDim};cursor:pointer;font-size:0.9rem;padding:0 4px;">&times;</button>
                </div>
            </div>
            <div id="monowe-debug-output" style="height:200px;overflow-y:auto;padding:6px 10px;font-family:'SF Mono','Cascadia Code',Consolas,monospace;font-size:0.65rem;color:${c.text};line-height:1.5;"></div>
            <div id="monowe-debug-resize" style="position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,${c.textDim} 50%);border-radius:0 0 10px 0;opacity:0.5;"></div>
        `;
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            width: '420px',
            height: '260px',
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: '10px',
            zIndex: '999999',
            boxShadow: c.shadow,
            display: 'none',
            overflow: 'hidden',
        });
        document.body.appendChild(container);

        // Drag functionality
        const header = document.getElementById('monowe-debug-header');
        let isDragging = false, dragOffsetX, dragOffsetY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            dragOffsetX = e.clientX - container.getBoundingClientRect().left;
            dragOffsetY = e.clientY - container.getBoundingClientRect().top;
            container.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            container.style.left = (e.clientX - dragOffsetX) + 'px';
            container.style.top = (e.clientY - dragOffsetY) + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                container.style.transition = '';
            }
        });

        // Resize functionality
        const resizeHandle = document.getElementById('monowe-debug-resize');
        let isResizing = false, startW, startH, startX, startY;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startW = container.offsetWidth;
            startH = container.offsetHeight;
            startX = e.clientX;
            startY = e.clientY;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newW = Math.max(250, startW + (e.clientX - startX));
            const newH = Math.max(100, startH + (startY - e.clientY));
            container.style.width = newW + 'px';
            container.style.height = newH + 'px';
            const output = document.getElementById('monowe-debug-output');
            if (output) output.style.height = (newH - 40) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });

        // Close button
        document.getElementById('monowe-debug-close').addEventListener('click', () => {
            debugConsoleVisible = false;
            container.style.display = 'none';
        });

        // Clear button
        document.getElementById('monowe-debug-clear').addEventListener('click', () => {
            debugLogs.length = 0;
            const output = document.getElementById('monowe-debug-output');
            if (output) output.innerHTML = '<div style="color:' + c.textDim + '">Cleared</div>';
        });

        return container;
    }

    function toggleDebugConsole() {
        let console = document.getElementById('monowe-debug-console');
        if (!console) console = createDebugConsole();
        debugConsoleVisible = !debugConsoleVisible;
        console.style.display = debugConsoleVisible ? 'block' : 'none';
        if (debugConsoleVisible) updateDebugConsole();
    }

    function updateDebugConsole() {
        if (!debugConsoleVisible) return;
        const output = document.getElementById('monowe-debug-output');
        if (!output) return;
        const c = getThemeColors();

        output.innerHTML = debugLogs.map((entry, i) => {
            const isError = entry.msg.toLowerCase().includes('error') || entry.msg.toLowerCase().includes('fail');
            const color = isError ? '#ff6b6b' : c.textDim;
            return `<div style="color:${color};border-bottom:1px solid ${c.border};padding:2px 0;"><span style="color:${c.accent};">${entry.time}</span> ${entry.msg}</div>`;
        }).join('');

        output.scrollTop = output.scrollHeight;
    }

    // Add debug button to minimap header
    function addDebugButton() {
        const headerRight = document.querySelector('.monowe-header-right');
        if (!headerRight || document.getElementById('monowe-debug-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'monowe-debug-btn';
        btn.title = 'Debug Console';
        btn.textContent = '\u{1F41B}';
        btn.style.cssText = 'font-size:0.85rem;';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDebugConsole();
        });
        headerRight.insertBefore(btn, headerRight.firstChild);
    }

    // ─── MAIN ────────────────────────────────────────────────────
    let mapObj = null;

    async function main() {
        log('script starting... v2.0');

        listeners.push((coords) => {
            if (mapObj) updateMap(mapObj, coords);
            reverseGeocode(coords.lat, coords.lng);
        });

        hookNetwork();
        hookJSONP();
        hookIframes();
        hookGoogleMapsAPI();
        hookGameMap();
        setupHotkey();

        // Monitor ALL network requests via PerformanceObserver
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    log('NET:', entry.initiatorType, entry.name.substring(0, 150));
                }
            });
            observer.observe({ entryTypes: ['resource'] });
        } catch {}

        await showWelcomeAnimation();

        createMiniMap();
        addDebugButton();
        mapObj = await initLeafletMap();
        log('minimap ready');
        if (settings.compactMode) applyCompactMode();

        if (lastCoords) {
            log('applying early coords:', lastCoords.lat, lastCoords.lng);
            if (mapObj) updateMap(mapObj, lastCoords);
            reverseGeocode(lastCoords.lat, lastCoords.lng);
        }

        scanPageHTML();
        setTimeout(scanPageHTML, 3000);
        setTimeout(scanPageHTML, 6000);

        // Reposition settings panel on window resize
        window.addEventListener('resize', repositionSettingsPanel);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        document.addEventListener('DOMContentLoaded', main);
    }
})();

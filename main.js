// ==UserScript==
// @name         OpenGuessr cheat
// @namespace    monowe
// @version      1.2
// @description  Easy to use location hack/cheat
// @match        https://www.openguessr.com/*
// @match        https://openguessr.com/*
// @grant        none
// @run-at       document-start
// @license MIT
// ==/UserScript==
 
(function () {
    'use strict';
 
    // ─── CONFIG ───────────────────────────────────────────────────
    const ANIMATION_DURATION = 4000;
    const MAP_SIZE = { w: 280, h: 220 };
 
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
 
    // ─── METHOD 1: Hook Google Maps API when it loads ─────────────
    function hookGoogleMapsAPI() {
        const check = setInterval(() => {
            if (!window.google || !window.google.maps) return;
            clearInterval(check);
 
            console.log('[monowe] Google Maps API detected, hooking...');
            const SVP = window.google.maps.StreetViewPanorama;
            if (!SVP) return;
 
            // Track all panorama instances
            const instances = new Set();
 
            // Hook constructor to catch new panorama creations
            const origCtor = SVP;
            const handler = {
                construct(target, args) {
                    const instance = new target(...args);
                    instances.add(instance);
                    hookInstance(instance);
                    // Read initial position
                    setTimeout(() => readPosition(instance), 500);
                    return instance;
                }
            };
            // Replace the constructor
            const proxied = new Proxy(origCtor, handler);
            window.google.maps.StreetViewPanorama = proxied;
            // Copy prototype chain
            proxied.prototype = origCtor.prototype;
 
            // Hook existing instances found in DOM
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
                } catch (e) {}
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
                } catch (e) {}
            }
 
            function hookInstance(pano) {
                // Hook setPosition
                if (typeof pano.setPosition === 'function' && !pano._monoweHooked) {
                    pano._monoweHooked = true;
                    const origSetPos = pano.setPosition.bind(pano);
                    pano.setPosition = function (latLng) {
                        const result = origSetPos(latLng);
                        setTimeout(() => readPosition(pano), 100);
                        return result;
                    };
                }
                // Hook set
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
 
            // Periodically scan for new/changed panoramas
            setInterval(() => {
                scanExisting();
                for (const pano of instances) {
                    readPosition(pano);
                }
            }, 2000);
 
            // Initial scan
            scanExisting();
            for (const pano of instances) {
                readPosition(pano);
            }
        }, 500);
    }
 
    // ─── METHOD 2: Intercept fetch/XHR (catches API responses) ────
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
            } catch (e) {}
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
                } catch (e) {}
            });
            return origSend.apply(this, a);
        };
    }
 
    // ─── METHOD 3: Hook JSONP callbacks (Google Maps uses these) ──
    function hookJSONP() {
        // Intercept script tag creation to catch JSONP callbacks
        const origAppendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function (node) {
            if (node.tagName === 'SCRIPT' && node.src) {
                // Check if it's a Google Maps JSONP call
                if (node.src.includes('maps.googleapis.com') || node.src.includes('callback=')) {
                    const origCb = node.onload;
                    node.addEventListener('load', () => {
                        try {
                            // After JSONP loads, scan for coords in global scope
                            scanGlobalScope();
                        } catch (e) {}
                    });
                }
            }
            return origAppendChild.call(this, node);
        };
 
        // Hook global callback functions
        const origDefineProperty = Object.defineProperty;
        let callbackCount = 0;
        setInterval(() => {
            scanGlobalScope();
        }, 3000);
    }
 
    function scanGlobalScope() {
        // Look for Google Maps panorama instances in window
        try {
            for (const key in window) {
                try {
                    const obj = window[key];
                    if (!obj || typeof obj !== 'object') continue;
                    // Check for getPosition
                    if (typeof obj.getPosition === 'function') {
                        const pos = obj.getPosition();
                        if (pos) {
                            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                            if (lat && lng) emitCoords({ lat, lng });
                        }
                    }
                    // Check for nested pano
                    if (obj.pano && typeof obj.pano.getPosition === 'function') {
                        const pos = obj.pano.getPosition();
                        if (pos) {
                            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                            if (lat && lng) emitCoords({ lat, lng });
                        }
                    }
                    // Check for position property
                    if (obj.position && typeof obj.position === 'object') {
                        const lat = obj.position.lat;
                        const lng = obj.position.lng;
                        if (lat && lng && isFinite(lat) && isFinite(lng)) {
                            emitCoords({ lat: typeof lat === 'function' ? lat() : lat, lng: typeof lng === 'function' ? lng() : lng });
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
 
    // ─── METHOD 4: MutationObserver on iframes (Street View embed) ─
    function hookIframes() {
        function extractFromUrl(url) {
            if (!url) return;
            // cbll param: Google Maps Street View embed
            const cbll = url.match(/cbll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (cbll) emitCoords({ lat: parseFloat(cbll[1]), lng: parseFloat(cbll[2]) });
            // location param
            const loc = url.match(/location=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (loc) emitCoords({ lat: parseFloat(loc[1]), lng: parseFloat(loc[2]) });
        }
 
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                // Check added nodes
                for (const node of m.addedNodes) {
                    if (node.tagName === 'IFRAME') {
                        extractFromUrl(node.src || node.getAttribute('src') || '');
                    }
                    // Check child iframes
                    if (node.querySelectorAll) {
                        for (const iframe of node.querySelectorAll('iframe')) {
                            extractFromUrl(iframe.src || iframe.getAttribute('src') || '');
                        }
                    }
                }
                // Check attribute changes (iframe src changes on round switch)
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
 
        // Also scan existing iframes
        setTimeout(() => {
            for (const iframe of document.querySelectorAll('iframe')) {
                extractFromUrl(iframe.src || iframe.getAttribute('src') || '');
            }
        }, 2000);
    }
 
    // ─── METHOD 5: Scan page HTML for embedded coordinates ────────
    function scanPageHTML() {
        const html = document.documentElement.innerHTML;
        // Look for Street View embed URLs with coordinates
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
 
    // ─── ANIMATION OVERLAY ────────────────────────────────────────
    function showWelcomeAnimation() {
        return new Promise((resolve) => {
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
                    position: fixed;
                    inset: 0;
                    z-index: 999999;
                    background: #000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 1;
                    transition: opacity 0.8s ease-out;
                }
                #monowe-welcome.fade-out {
                    opacity: 0;
                    pointer-events: none;
                }
                #monowe-particles {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                }
                .monowe-text {
                    position: relative;
                    z-index: 1;
                    text-align: center;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    opacity: 0;
                    animation: monowe-fadeIn 1.8s ease-out 0.6s forwards;
                }
                .monowe-made {
                    display: block;
                    font-size: 1.6rem;
                    color: rgba(255,255,255,0.6);
                    letter-spacing: 0.3em;
                    text-transform: uppercase;
                    margin-bottom: 0.4rem;
                }
                .monowe-name {
                    display: block;
                    font-size: 4rem;
                    font-weight: 700;
                    letter-spacing: 0.15em;
                    background: linear-gradient(135deg, #00d4ff, #7b2fff, #ff2d95);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    filter: drop-shadow(0 0 30px rgba(0,212,255,0.5))
                            drop-shadow(0 0 60px rgba(123,47,255,0.3));
                    animation: monowe-glow 2s ease-in-out infinite alternate;
                }
                @keyframes monowe-fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes monowe-glow {
                    from { filter: drop-shadow(0 0 20px rgba(0,212,255,0.4))
                                   drop-shadow(0 0 40px rgba(123,47,255,0.2)); }
                    to   { filter: drop-shadow(0 0 35px rgba(0,212,255,0.7))
                                   drop-shadow(0 0 70px rgba(123,47,255,0.4)); }
                }
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
                    resolve();
                }, 800);
            }, ANIMATION_DURATION);
        });
    }
 
    // ─── MINI-MAP ─────────────────────────────────────────────────
    function createMiniMap() {
        const container = document.createElement('div');
        container.id = 'monowe-minimap';
        container.innerHTML = `
            <div class="monowe-map-header">
                <span>Your Location</span>
                <button id="monowe-map-toggle">−</button>
            </div>
            <div id="monowe-map-body"></div>
        `;
        document.body.appendChild(container);
 
        const style = document.createElement('style');
        style.textContent = `
            #monowe-minimap {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999998;
                width: ${MAP_SIZE.w}px;
                background: rgba(18,18,18,0.95);
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
                font-family: 'Segoe UI', system-ui, sans-serif;
                backdrop-filter: blur(12px);
                cursor: move;
                user-select: none;
            }
            .monowe-map-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: rgba(0,0,0,0.4);
                color: rgba(255,255,255,0.85);
                font-size: 0.8rem;
                letter-spacing: 0.05em;
            }
            .monowe-map-header button {
                background: none;
                border: none;
                color: rgba(255,255,255,0.6);
                cursor: pointer;
                font-size: 1.1rem;
                padding: 0 4px;
                line-height: 1;
            }
            .monowe-map-header button:hover {
                color: #fff;
            }
            #monowe-map-body {
                height: ${MAP_SIZE.h}px;
                transition: height 0.3s ease;
            }
            #monowe-map-body.collapsed {
                height: 0;
            }
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
        `;
        document.head.appendChild(style);
 
        const toggleBtn = document.getElementById('monowe-map-toggle');
        const mapBody = document.getElementById('monowe-map-body');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const collapsed = mapBody.classList.toggle('collapsed');
            toggleBtn.textContent = collapsed ? '+' : '−';
        });
 
        let isDragging = false, offsetX, offsetY;
        container.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
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
            isDragging = false;
            container.style.transition = '';
        });
 
        return container;
    }
 
    // ─── MAP INITIALIZATION ───────────────────────────────────────
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
        }).setView([20, 0], 1);
 
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
        const { map, marker } = mapObj;
        const latlng = [coords.lat, coords.lng];
        marker.setLatLng(latlng);
        map.setView(latlng, 12, { animate: true, duration: 0.8 });
    }
 
    // ─── MAIN ─────────────────────────────────────────────────────
    let mapObj = null;
 
    async function main() {
        console.log('[monowe] script starting...');
 
        // Register listener immediately — stores coords until map is ready
        listeners.push((coords) => {
            if (mapObj) {
                updateMap(mapObj, coords);
            }
            // If map not ready yet, coords are in lastCoords — will be applied below
        });
 
        // Start all hooks immediately
        hookNetwork();
        hookJSONP();
        hookIframes();
        hookGoogleMapsAPI();
 
        // Phase 1: Welcome animation
        await showWelcomeAnimation();
 
        // Phase 2: Create minimap
        createMiniMap();
        mapObj = await initLeafletMap();
        console.log('[monowe] minimap ready');
 
        // Apply any coords that arrived before map was ready
        if (lastCoords) {
            console.log('[monowe] applying early coords:', lastCoords.lat, lastCoords.lng);
            updateMap(mapObj, lastCoords);
        }
 
        // Scan page HTML for embedded coordinates
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

/*
 * Prueba de interfaz con Chromium headless (CDP, sin dependencias):
 *   node tests/ui.test.js
 * Sirve el proyecto por http://127.0.0.1 (contexto seguro para el SW),
 * carga la app, revisa errores de consola, desbordamiento horizontal en
 * varios anchos, juega los primeros turnos contra la CPU, verifica el
 * precache del service worker y que la app cargue OFFLINE.
 * Guarda capturas en tests/captura-inicio.png y tests/captura-partida.png.
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PUERTO_HTTP = 8123;
const PUERTO_CDP = 9333;
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const URL = 'http://127.0.0.1:' + PUERTO_HTTP + '/index.html';

let pasadas = 0, falladas = 0;
function prueba(nombre, cond, detalle) {
  if (cond) { pasadas++; console.log('  ok  ' + nombre); }
  else { falladas++; console.log('  FALLO  ' + nombre + (detalle ? ' — ' + detalle : '')); }
}
function dormir(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const servidor = spawn('python3', ['-m', 'http.server', String(PUERTO_HTTP), '--bind', '127.0.0.1'], { cwd: RAIZ, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    '--headless', '--remote-debugging-port=' + PUERTO_CDP,
    '--window-size=375,850', '--no-sandbox', '--disable-gpu', URL
  ], { stdio: 'ignore' });
  try {
    // Esperar al objetivo de página
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await dormir(400);
      try {
        const lista = await getJSON('http://127.0.0.1:' + PUERTO_CDP + '/json/list');
        target = lista.find(t => t.type === 'page');
      } catch (e) {}
    }
    if (!target) throw new Error('Chromium no expuso objetivo de página');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pendientes = new Map();
    const erroresConsola = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendientes.has(msg.id)) { pendientes.get(msg.id)(msg); pendientes.delete(msg.id); }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
        erroresConsola.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
        erroresConsola.push(msg.params.entry.text);
      if (msg.method === 'Page.javascriptDialogOpening')
        send('Page.handleJavaScriptDialog', { accept: true });
    };
    function send(method, params) {
      return new Promise(resolve => {
        const id = ++seq;
        pendientes.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    }
    async function evaluar(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails)
        throw new Error('Error evaluando: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    }
    async function esperar(condExpr, ms) {
      const tope = Date.now() + (ms || 8000);
      while (Date.now() < tope) {
        if (await evaluar(condExpr)) return true;
        await dormir(300);
      }
      return false;
    }
    async function captura(archivo) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(__dirname, archivo), Buffer.from(r.result.data, 'base64'));
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');

    console.log('Interfaz — prueba con Chromium headless');
    await esperar("document.readyState === 'complete'", 10000);
    await esperar("!!document.querySelector('#btn-jugar')", 5000);
    await dormir(1200); // fetch de datos-cartas.json

    prueba('La pantalla de inicio carga con el banner visible',
      await evaluar("!!document.querySelector('#pantalla-inicio.activa') && document.querySelector('.banner').complete && document.querySelector('.banner').naturalWidth > 0"));
    await captura('captura-inicio.png');

    // Desbordamiento horizontal en 8 anchos (pasada Hallmark)
    for (const ancho of [320, 375, 414, 768, 1024, 1280, 1440, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: 900, deviceScaleFactor: 1, mobile: ancho < 768 });
      await dormir(250);
      const desborda = await evaluar('document.documentElement.scrollWidth > ' + ancho);
      prueba('Sin desbordamiento horizontal a ' + ancho + ' px (inicio)', !desborda);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 850, deviceScaleFactor: 1, mobile: true });
    await dormir(300);

    // Empezar partida y jugar turnos reales contra la CPU
    await evaluar("localStorage.clear(); document.querySelector('#btn-jugar').click()");
    await esperar("!!document.querySelector('#pantalla-juego.activa')", 5000);
    prueba('La partida empieza y la mano tiene 11 cartas',
      await evaluar("document.querySelectorAll('#mano .carta').length === 11"),
      await evaluar("String(document.querySelectorAll('#mano .carta').length)"));
    await captura('captura-partida.png');
    for (const ancho of [320, 375, 414]) {
      await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: 850, deviceScaleFactor: 1, mobile: true });
      await dormir(200);
      const desborda = await evaluar('document.documentElement.scrollWidth > ' + ancho);
      prueba('Sin desbordamiento horizontal a ' + ancho + ' px (partida)', !desborda);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 850, deviceScaleFactor: 1, mobile: true });

    await evaluar("document.querySelector('[data-accion=\"robar\"]').click()");
    await esperar("document.querySelectorAll('#mano .carta').length === 13", 5000);
    prueba('Robar 2 cartas funciona (11 -> 13)',
      await evaluar("document.querySelectorAll('#mano .carta').length === 13"));
    await evaluar("document.querySelector('#mano .carta').click()");
    await evaluar("document.querySelector('[data-accion=\"descartar\"]').click()");
    const volvio = await esperar(
      "document.querySelector('#barra-acciones').textContent.includes('Robar') || !!document.querySelector('#pantalla-fin-mano.activa')", 9000);
    prueba('Tras descartar, la CPU juega su turno y la partida sigue', volvio);
    prueba('La partida se guardó en localStorage para continuarla',
      await evaluar("!!localStorage.getItem('canasta_partida_v1')"));

    // Service worker y precache completo
    const swListo = await esperar("navigator.serviceWorker && navigator.serviceWorker.controller !== null", 9000);
    prueba('El service worker controla la página', swListo);
    const enCache = await evaluar("caches.open('canasta-v1').then(c => c.keys()).then(k => k.length)");
    prueba('El precache canasta-v1 guarda los 64 recursos', enCache === 64, 'hay ' + enCache);

    // Offline: sin red, la app debe cargar desde la caché
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send('Page.reload');
    await esperar("document.readyState === 'complete'", 8000);
    await dormir(1000);
    prueba('Sin conexión, la app sigue cargando (banner desde caché)',
      await evaluar("!!document.querySelector('#pantalla-inicio.activa') && document.querySelector('.banner').complete && document.querySelector('.banner').naturalWidth > 0"));
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    prueba('Sin errores de consola en toda la sesión', erroresConsola.length === 0, erroresConsola.join(' | ').slice(0, 300));
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    servidor.kill('SIGKILL');
  }
  console.log('\nResultado UI: ' + pasadas + ' pasadas, ' + falladas + ' falladas');
  process.exit(falladas ? 1 : 0);
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });

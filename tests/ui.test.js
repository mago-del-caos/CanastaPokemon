/*
 * Prueba de interfaz con Chromium headless (CDP, sin dependencias):
 *   node tests/ui.test.js
 * Sirve el proyecto por http://127.0.0.1 (contexto seguro para el SW),
 * carga la app, revisa errores de consola, desbordamiento horizontal en
 * varios anchos, juega turnos reales contra la CPU en los tres niveles
 * de dificultad, ejercita pista, deshacer, orden de mano, ajustes y la
 * pantalla de fin de mano, verifica el precache del service worker y
 * que la app cargue OFFLINE. Auditoría: cero errores de consola en
 * toda la sesión.
 * Guarda capturas en tests/captura-inicio.png y tests/captura-partida.png.
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('../canasta.js');

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
function esperarHttp(url, intentos) {
  return new Promise(resolve => {
    let n = 0;
    (function intento() {
      http.get(url, res => { res.resume(); resolve(res.statusCode === 200); })
        .on('error', () => { if (++n < intentos) setTimeout(intento, 250); else resolve(false); });
    })();
  });
}

// Guarda una partida fabricada con el motor para inyectarla en la app.
function guardadoJSON(spec) {
  const partida = C.crearPartida();
  const estado = C._debug.crearManoPersonalizada(spec);
  return JSON.stringify({ partida: partida, estado: estado, registroManos: [] });
}

async function main() {
  const servidor = spawn('python3', ['-m', 'http.server', String(PUERTO_HTTP), '--bind', '127.0.0.1'], { cwd: RAIZ, stdio: 'ignore' });
  if (!await esperarHttp(URL, 40)) throw new Error('El servidor HTTP no respondió');
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
      if (msg.method === 'Runtime.exceptionThrown')
        erroresConsola.push('Excepción: ' + (msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text || '').slice(0, 200));
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
    const clic = sel => evaluar("document.querySelector('" + sel + "').click()");
    const clicAccion = nombre => esperar("!!document.querySelector('[data-accion=\"" + nombre + "\"]')", 12000)
      .then(ok => ok ? clic('[data-accion="' + nombre + '"]') : Promise.reject(new Error('No apareció la acción ' + nombre)));

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

    // Pantalla de reglas y de ajustes (auditoría de pantallas)
    await clic('#btn-reglas');
    prueba('La pantalla de reglas se abre', await esperar("!!document.querySelector('#pantalla-reglas.activa')", 4000));
    await clic('#btn-volver-inicio');
    await esperar("!!document.querySelector('#pantalla-inicio.activa')", 4000);
    await clic('#btn-ajustes');
    prueba('La pantalla de ajustes se abre', await esperar("!!document.querySelector('#pantalla-ajustes.activa')", 4000));
    await clic('[data-velocidad="rapida"]');
    prueba('El ajuste de velocidad se marca activo',
      await evaluar("document.querySelector('[data-velocidad=\"rapida\"]').classList.contains('activo')"));
    await clic('#btn-volver-ajustes');
    await esperar("!!document.querySelector('#pantalla-inicio.activa')", 4000);

    // ---- Turnos reales contra la CPU en los tres niveles ----
    for (const nivel of ['facil', 'normal', 'dificil']) {
      await clic('[data-dificultad="' + nivel + '"]');
      prueba('Dificultad ' + nivel + ': el selector queda activo',
        await evaluar("document.querySelector('[data-dificultad=\"" + nivel + "\"]').classList.contains('activo')"));
      await evaluar("localStorage.removeItem('canasta_partida_v1')");
      await clic('#btn-jugar');
      await esperar("!!document.querySelector('#pantalla-juego.activa')", 5000);
      // La CPU puede empezar la mano: se espera el botón de robar.
      await clicAccion('pista');
      prueba('Dificultad ' + nivel + ': la pista responde sin jugar por el usuario',
        await evaluar("document.querySelector('#mensaje').textContent.startsWith('Pista:')"));
      await clicAccion('robar');
      const trece = await esperar("document.querySelectorAll('#mano .carta').length === 13", 6000);
      prueba('Dificultad ' + nivel + ': robar 2 cartas funciona (11 -> 13)', trece);
      if (nivel === 'facil') await captura('captura-partida.png');
      // Ordenar por palo y volver a valor
      await clic('#btn-orden-palo');
      prueba('Dificultad ' + nivel + ': ordenar por palo se activa',
        await evaluar("document.querySelector('#btn-orden-palo').classList.contains('activo')"));
      await clic('#btn-orden-valor');
      // Descartar la primera carta y esperar a que la CPU juegue
      await evaluar("document.querySelector('#mano .carta').click()");
      await clicAccion('descartar');
      const sigue = await esperar(
        "!!document.querySelector('[data-accion=\"robar\"]') || !!document.querySelector('#pantalla-fin-mano.activa')", 15000);
      prueba('Dificultad ' + nivel + ': tras descartar, la CPU juega y la partida sigue', sigue);
      if (nivel === 'facil') {
        prueba('La partida se guardó en localStorage para continuarla',
          await evaluar("!!localStorage.getItem('canasta_partida_v1')"));
      }
      // Botón de sonido en la cabecera
      await clic('#btn-sonido');
      prueba('Dificultad ' + nivel + ': el botón de sonido alterna su estado',
        await evaluar("document.querySelector('#btn-sonido').textContent === 'Sonido: no'"));
      await clic('#btn-sonido');
      // Volver al inicio abandonando (el diálogo se acepta solo)
      await clic('#btn-abandonar');
      await esperar("!!document.querySelector('#pantalla-inicio.activa')", 5000);
    }
    // ---- Escenario inyectado: pista de fusión, deshacer y descarte ----
    const guardado1 = guardadoJSON({
      manos: [['KC', '9S', '4D'], ['5C', '6C']],
      fusiones: { 0: { K: ['KS', 'KH', 'KD'] } },
      fusionado: [true, false], turno: 0, fase: 'robar',
      pozo: ['7S'], mazo: ['8C', '6H', '10D', 'QS']
    });
    await evaluar("localStorage.setItem('canasta_partida_v1', " + JSON.stringify(guardado1) + ")");
    await send('Page.reload');
    await esperar("!!document.querySelector('#btn-continuar') && !document.querySelector('#btn-continuar').classList.contains('oculto')", 8000);
    await clic('#btn-continuar');
    await esperar("!!document.querySelector('#pantalla-juego.activa')", 5000);
    await clicAccion('robar');
    await esperar("document.querySelectorAll('#mano .carta').length === 5", 6000);
    // Fusionar el KC con la fusión de K en mesa (la primera carta, orden por valor)
    await evaluar("document.querySelector('#mano .carta').click()");
    await clic('#mis-fusiones .fusion');
    const fusion4 = await esperar("document.querySelectorAll('#mis-fusiones .fusion .carta').length === 4", 5000);
    prueba('Escenario: añadir una carta a la fusión en mesa funciona', fusion4);
    const hayDeshacer = await esperar("!!document.querySelector('[data-accion=\"deshacer\"]')", 4000);
    prueba('Escenario: tras fusionar aparece «Deshacer fusiones»', hayDeshacer);
    await clicAccion('deshacer');
    const deshecho = await esperar(
      "document.querySelectorAll('#mis-fusiones .fusion .carta').length === 3 && document.querySelectorAll('#mano .carta').length === 5", 5000);
    prueba('Escenario: deshacer devuelve la carta a la mano y la fusión a 3', deshecho);
    await clicAccion('pista');
    prueba('Escenario: la pista de fusión resalta cartas de la mano',
      await evaluar("document.querySelectorAll('#mano .carta.pista').length >= 1"));
    // Descartar para cerrar el turno
    await evaluar("document.querySelector('#mano .carta').click()");
    await clicAccion('descartar');
    const trasDescarte = await esperar(
      "!!document.querySelector('[data-accion=\"robar\"]') || !!document.querySelector('#pantalla-fin-mano.activa')", 15000);
    prueba('Escenario: el turno se cierra y la CPU responde', trasDescarte);
    await clic('#btn-abandonar');
    await esperar("!!document.querySelector('#pantalla-inicio.activa')", 5000);

    // ---- Escenario inyectado: fin de mano con tabla mano a mano ----
    const guardado2 = guardadoJSON({
      manos: [['4S'], ['5C', '6C']],
      fusiones: { 0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] } },
      fusionado: [true, false], turno: 0, fase: 'jugar',
      pozo: ['7S'], mazo: ['8C', '6H']
    });
    await evaluar("localStorage.setItem('canasta_partida_v1', " + JSON.stringify(guardado2) + ")");
    await send('Page.reload');
    await esperar("!!document.querySelector('#btn-continuar') && !document.querySelector('#btn-continuar').classList.contains('oculto')", 8000);
    await clic('#btn-continuar');
    await esperar("!!document.querySelector('#pantalla-juego.activa')", 5000);
    prueba('Escenario fin: con canasta en mesa se muestra el aviso de salida',
      await esperar("!document.querySelector('#aviso-salir').classList.contains('oculto')", 4000));
    prueba('Escenario fin: la canasta natural lleva la marca roja de carta cruzada',
      await evaluar("!!document.querySelector('#mis-fusiones .marca-canasta.roja')"));
    await evaluar("document.querySelector('#mano .carta').click()");
    await clicAccion('descartar');
    const finMano = await esperar("!!document.querySelector('#pantalla-fin-mano.activa')", 8000);
    prueba('Escenario fin: al salir se abre la pantalla de fin de mano', finMano);
    prueba('Escenario fin: la tabla mano a mano registra la mano jugada',
      await evaluar("document.querySelectorAll('#fin-mano-historial tbody tr').length === 1"));
    await clic('#btn-siguiente-mano');
    await esperar("!!document.querySelector('#pantalla-juego.activa')", 5000);
    await clic('#btn-abandonar');
    await esperar("!!document.querySelector('#pantalla-inicio.activa')", 5000);

    // Service worker y precache completo
    const swListo = await esperar("navigator.serviceWorker && navigator.serviceWorker.controller !== null", 9000);
    prueba('El service worker controla la página', swListo);
    const enCache = await evaluar("caches.open('canasta-v2').then(c => c.keys()).then(k => k.length)");
    prueba('El precache canasta-v2 guarda los 64 recursos', enCache === 64, 'hay ' + enCache);

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

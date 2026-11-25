/*
 * Pruebas del motor de Canasta (canasta.js). Sin dependencias:
 *   node tests/motor.test.js
 * Incluye: invariantes en partidas completas CPU vs CPU y con movimientos
 * aleatorios legales, y escenarios guionizados con resultado calculado a mano.
 */
'use strict';
const assert = require('assert');
const C = require('../canasta.js');

let pasadas = 0, falladas = 0;
function prueba(nombre, fn) {
  try { fn(); pasadas++; console.log('  ok  ' + nombre); }
  catch (e) { falladas++; console.log('  FALLO  ' + nombre + '\n        ' + e.message); }
}
function idsDe(estado, j, codigos) {
  const mano = estado.players[j].hand;
  const usados = new Set();
  return codigos.map(cod => {
    const c = mano.find(x => C.codigoCarta(x) === cod && !usados.has(x.uid));
    assert(c, 'carta ' + cod + ' no está en la mano');
    usados.add(c.uid);
    return c.uid;
  });
}

// ---------- Jugador aleatorio legal (usa solo la API del motor) ----------
function turnoAleatorio(estado, rng) {
  const idx = estado.turn;
  const jugador = estado.players[idx];
  const info = C.puedeRobarPozo(estado, idx);
  let tomo = false;
  if (info.puede && rng() < 0.4) {
    const op = info.opciones[Math.floor(rng() * info.opciones.length)];
    const plan = { tipo: op.tipo };
    if (!jugador.hasMelded) {
      const usadas = {}; op.ids.forEach(id => { usadas[id] = true; });
      const resto = jugador.hand.filter(c => !usadas[c.uid]);
      const minimo = C.minimoInicial(estado.puntajesPrevios[idx]);
      const puntosCombo = C.puntosDeCartas(op.ids) + C.valorCarta(C.cartaParaEmpatar(estado).carta);
      if (puntosCombo < minimo) {
        const grupos = C.buscarGruposIniciales(resto, minimo - puntosCombo);
        if (grupos) plan.gruposExtra = grupos.map(g => g.map(c => c.uid));
      }
    }
    tomo = C.tomarPozo(estado, plan).ok;
  }
  if (!tomo) {
    const r = C.robarDelMazo(estado);
    assert(r.ok, 'robarDelMazo falló: ' + r.error);
    if (r.finDeMano) return;
  }
  if (estado.phase !== 'jugar') return;
  // Fusiones aleatorias
  if (!jugador.hasMelded && rng() < 0.75) {
    const minimo = C.minimoInicial(estado.puntajesPrevios[idx]);
    const grupos = C.buscarGruposIniciales(jugador.hand, minimo);
    if (grupos) {
      const total = grupos.reduce((s, g) => s + g.length, 0);
      const restantes = jugador.hand.length - total;
      const hayCanasta = grupos.some(g => g.length === 7);
      if (restantes >= 2 || (restantes >= 0 && hayCanasta))
        C.fusionInicial(estado, grupos.map(g => g.map(c => c.uid)));
    }
  } else if (jugador.hasMelded) {
    for (let intento = 0; intento < 3 && estado.phase === 'jugar'; intento++) {
      const g = C.agruparMano(jugador.hand);
      const rangos = Object.keys(g.naturales).filter(r => g.naturales[r].length >= 3);
      if (!rangos.length) break;
      const rango = rangos[Math.floor(rng() * rangos.length)];
      C.fusionar(estado, g.naturales[rango].slice(0, 7).map(c => c.uid));
    }
  }
  if (estado.phase !== 'jugar') return;
  // Descarte aleatorio legal
  const orden = jugador.hand.slice();
  for (let i = orden.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); const t = orden[i]; orden[i] = orden[j]; orden[j] = t;
  }
  for (const c of orden) if (C.descartar(estado, c.uid).ok) return;
  throw new Error('Jugador aleatorio sin descarte legal (posible bloqueo del motor)');
}

function jugarPartida(semilla, turnoFn, etiqueta) {
  const rng = C.crearRng(semilla);
  const partida = C.crearPartida();
  let manos = 0, turnosTotales = 0;
  while (!partida.terminada) {
    assert(++manos <= 300, etiqueta + ': demasiadas manos sin cerrar el partido');
    const estado = C.nuevaMano(partida, rng);
    assert.deepStrictEqual(C.validarInvariantes(estado), [], etiqueta + ': invariantes tras reparto');
    let turnos = 0;
    while (estado.phase !== 'fin') {
      assert(++turnos <= 3000, etiqueta + ': mano sin terminar tras 3000 turnos');
      turnoFn(estado, rng);
      turnosTotales++;
      const problemas = C.validarInvariantes(estado);
      assert.deepStrictEqual(problemas, [], etiqueta + ': ' + problemas.join(' | '));
      estado.players.forEach((j, i) => {
        if (estado.phase !== 'fin')
          assert(j.hand.length > 0, etiqueta + ': jugador ' + i + ' con mano vacía fuera de fin de mano');
      });
    }
    assert(estado.resultado, etiqueta + ': la mano terminó sin resultado');
    const previo = partida.puntajes.slice();
    const res = C.cerrarMano(partida, estado);
    assert.strictEqual(partida.puntajes[0], previo[0] + estado.resultado.desglose[0].total);
    assert.strictEqual(partida.puntajes[1], previo[1] + estado.resultado.desglose[1].total);
    if (res.terminada) {
      assert(partida.puntajes[res.ganador] >= 5000, etiqueta + ': ganador sin llegar a 5000');
    }
  }
  return { manos, turnosTotales, puntajes: partida.puntajes };
}

// ================= PRUEBAS =================
console.log('Motor de Canasta — suite de pruebas');

prueba('El mazo tiene 108 cartas: 2 de cada palo/valor y 4 comodines', () => {
  const mazo = C.crearMazo();
  assert.strictEqual(mazo.length, 108);
  assert.strictEqual(mazo.filter(c => c.rank === 'JOKER').length, 4);
  assert.strictEqual(mazo.filter(c => C.codigoCarta(c) === 'AS').length, 2);
  assert.strictEqual(mazo.filter(c => C.esComodin(c)).length, 12); // 4 jokers + 8 doces
});

prueba('Mínimo de fusión inicial por tramo: 15 / 50 / 90 / 120', () => {
  assert.strictEqual(C.minimoInicial(-100), 15);
  assert.strictEqual(C.minimoInicial(-1), 15);
  assert.strictEqual(C.minimoInicial(0), 50);
  assert.strictEqual(C.minimoInicial(1495), 50);
  assert.strictEqual(C.minimoInicial(1500), 90);
  assert.strictEqual(C.minimoInicial(2995), 90);
  assert.strictEqual(C.minimoInicial(3000), 120);
  assert.strictEqual(C.minimoInicial(4999), 120);
});

prueba('Fusión inicial: se rechaza por debajo del mínimo con el conteo exacto', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['AS', 'AH', 'AD', 'KS', 'KH', 'KD', '5S', '5H', '5D', '9C', '4S', '7H'], ['4C']],
    fase: 'jugar', puntajesPrevios: [0, 0]
  });
  let r = C.fusionInicial(e, [idsDe(e, 0, ['KS', 'KH', 'KD'])]);
  assert(!r.ok && r.error.includes('llevas 30 de 50'), 'mensaje: ' + r.error);
  r = C.fusionInicial(e, [idsDe(e, 0, ['KS', 'KH', 'KD']), idsDe(e, 0, ['5S', '5H', '5D'])]);
  assert(!r.ok && r.error.includes('llevas 45 de 50'), 'mensaje: ' + r.error);
  r = C.fusionInicial(e, [idsDe(e, 0, ['AS', 'AH', 'AD'])]);
  assert(r.ok && r.puntos === 60, 'debió aceptar 60 puntos');
  assert.strictEqual(e.players[0].hasMelded, true);
});

prueba('Pozo congelado: con natural + comodín NO se puede; con pareja natural SÍ', () => {
  let e = C._debug.crearManoPersonalizada({
    manos: [['7S', 'JOKER', '9S', '9H', '9D', 'KC'], ['4C']],
    pozo: ['4D', '7H'], congelado: true, fase: 'robar'
  });
  let info = C.puedeRobarPozo(e, 0);
  assert.strictEqual(info.congelado, true);
  assert.strictEqual(info.puede, false);
  assert(info.motivo.includes('congelado'), info.motivo);
  assert(!C.tomarPozo(e, { tipo: 'naturalComodin' }).ok);

  e = C._debug.crearManoPersonalizada({
    manos: [['7S', '7C', 'JOKER', '9S', 'KC', '4S'], ['4C']],
    pozo: ['4D', '7H'], congelado: true, fase: 'robar'
  });
  info = C.puedeRobarPozo(e, 0);
  assert.strictEqual(info.puede, true);
  assert(info.opciones.every(o => o.tipo === 'pareja'));
  // La pareja + la carta superior valen 15 puntos < 50 del mínimo y la mano
  // no tiene más grupos: tomar el pozo debe fallar por la fusión inicial.
  const r = C.tomarPozo(e, { tipo: 'pareja' });
  assert(!r.ok && r.error.includes('fusión inicial'), r.error);
  assert.strictEqual(e.pile.length, 2, 'el pozo no debió moverse');
});

prueba('Pozo congelado: pareja + grupos extra que alcanzan el mínimo SÍ toma el pozo', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['7S', '7C', 'AS', 'AH', 'AD', 'KC', '4S', '9D'], ['4C']],
    pozo: ['8C', '4D', '7H'], congelado: true, fase: 'robar'
  });
  // pareja de 7 (10) + carta superior (5) + ases (60) = 75 >= 50
  const r = C.tomarPozo(e, { tipo: 'pareja', gruposExtra: [idsDe(e, 0, ['AS', 'AH', 'AD'])] });
  assert(r.ok, r.error);
  assert.strictEqual(e.pile.length, 0);
  assert.strictEqual(e.players[0].melds['7'].length, 3);
  assert.strictEqual(e.players[0].melds['A'].length, 3);
  assert.strictEqual(e.players[0].hasMelded, true);
  assert.strictEqual(e.phase, 'jugar');
});

prueba('Pozo NO congelado (jugador ya fusionó): natural + comodín SÍ', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['7S', 'JOKER', '3C', '9S', 'QD'], ['4C']],
    pozo: ['4D', '7H'], congelado: false, fusionado: [true, false], fase: 'robar',
    fusiones: { 0: { K: ['KS', 'KH', 'KD'] } }
  });
  const info = C.puedeRobarPozo(e, 0);
  assert.strictEqual(info.congelado, false);
  assert(info.opciones.some(o => o.tipo === 'naturalComodin'));
  const r = C.tomarPozo(e, { tipo: 'naturalComodin' });
  assert(r.ok, r.error);
  assert.strictEqual(e.players[0].melds['7'].length, 3); // 7S + comodín + 7H del pozo
});

prueba('Pozo NO congelado: la carta superior que encaja en una fusión basta', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['3C', '9S', 'QD', '5H'], ['4C']],
    pozo: ['4D', '7H'], congelado: false, fusionado: [true, false], fase: 'robar',
    fusiones: { 0: { '7': ['7S', '7D', '7C'] } }
  });
  const info = C.puedeRobarPozo(e, 0);
  assert(info.opciones.some(o => o.tipo === 'fusion'));
  const r = C.tomarPozo(e, { tipo: 'fusion' });
  assert(r.ok, r.error);
  assert.strictEqual(e.players[0].melds['7'].length, 4);
});

prueba('Un 3 negro arriba bloquea el pozo', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['7S', '7C', '9S', '9H'], ['4C']],
    pozo: ['4D', '3S'], congelado: false, fusionado: [true, false], fase: 'robar'
  });
  const info = C.puedeRobarPozo(e, 0);
  assert.strictEqual(info.puede, false);
  assert(info.motivo.includes('3 negro'), info.motivo);
});

prueba('Descartar un comodín congela el pozo para el rival', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['JOKER', '9S', 'QD', '5H', '8C'], ['7S', 'JOKER', '4S', '4H']],
    pozo: ['4D', '7H'], congelado: false, fusionado: [true, true], fase: 'jugar',
    fusiones: { 0: { K: ['KS', 'KH', 'KD'] }, 1: { Q: ['QS', 'QH', 'QD'] } }
  });
  const r = C.descartar(e, idsDe(e, 0, ['JOKER'])[0]);
  assert(r.ok, r.error);
  assert.strictEqual(e.pileFrozen, true);
  const info = C.puedeRobarPozo(e, 1); // turno del rival, pozo congelado
  assert.strictEqual(info.congelado, true);
  assert.strictEqual(info.puede, false); // solo tiene un 7 y un comodín
});

prueba('Puntuación: canasta natural 500, mixta 300, de comodines 2000', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [[], []],
    fusiones: {
      0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] },
      1: { K: ['KS', 'KH', 'KD', 'KC', 'KS', 'KH', 'JOKER'], WILD: ['JOKER', 'JOKER', '2S', '2H', '2D', '2C', 'JOKER'] }
    },
    fusionado: [true, true]
  });
  const d = C.puntuarMano(e, -1, false);
  assert.strictEqual(d[0].canastas, 500);
  assert.strictEqual(d[0].fusiones, 140); // 7 ases x 20
  assert.strictEqual(d[1].canastas, 300 + 2000);
});

prueba('3 rojos: +100 si fusionó, -100 si no fusionó nada', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [[], []],
    tresRojos: { 0: ['3H', '3D'], 1: ['3H'] },
    fusionado: [true, false]
  });
  const d = C.puntuarMano(e, -1, false);
  assert.strictEqual(d[0].tresRojos, 200);
  assert.strictEqual(d[1].tresRojos, -100);
});

prueba('Salida oculta vale 200 y la normal 100; el rival resta su mano', () => {
  // Salida oculta: sin haber fusionado, fusiona 7 ases (canasta) y descarta la última.
  let e = C._debug.crearManoPersonalizada({
    manos: [['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD', 'KS'], ['JOKER', 'AS', '9C']],
    fase: 'jugar', puntajesPrevios: [0, 0]
  });
  let r = C.fusionInicial(e, [idsDe(e, 0, ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'])]);
  assert(r.ok, r.error);
  r = C.descartar(e, idsDe(e, 0, ['KS'])[0]);
  assert(r.ok && r.salio && r.oculta, JSON.stringify(r));
  assert.strictEqual(e.resultado.desglose[0].salida, 200);
  assert.strictEqual(e.resultado.desglose[0].canastas, 500);
  assert.strictEqual(e.resultado.desglose[1].enMano, -(50 + 20 + 10)); // comodín + as + 9

  // Salida normal: ya había fusionado antes del turno.
  e = C._debug.crearManoPersonalizada({
    manos: [['KS'], ['9C']],
    fusiones: { 0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  e.players[0].fusionoAntesDelTurno = true;
  r = C.descartar(e, idsDe(e, 0, ['KS'])[0]);
  assert(r.ok && r.salio && !r.oculta, JSON.stringify(r));
  assert.strictEqual(e.resultado.desglose[0].salida, 100);
});

prueba('No se puede salir sin canasta (ni descartando ni fusionando todo)', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['KS'], ['9C']],
    fusiones: { 0: { Q: ['QS', 'QH', 'QD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  const r = C.descartar(e, idsDe(e, 0, ['KS'])[0]);
  assert(!r.ok && r.error.includes('canasta'), r.error);
});

prueba('Los comodines no pueden superar a las naturales en una fusión', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['AS', 'JOKER', '2H', '9C', '9S', '9D', '4H'], ['9C']],
    fase: 'jugar', puntajesPrevios: [-50, 0] // mínimo 15
  });
  const r = C.fusionInicial(e, [idsDe(e, 0, ['AS', 'JOKER', '2H'])]);
  assert(!r.ok && r.error.includes('comodines'), r.error);
});

prueba('Fusión cerrada (canasta) no acepta más cartas', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['AS', '9C', '9S', '4H'], ['9C']],
    fusiones: { 0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  const r = C.fusionar(e, idsDe(e, 0, ['AS']));
  assert(!r.ok && r.error.includes('cerrada'), r.error);
});

prueba('Los 3 negros solo se fusionan al salir', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['3S', '3C', '3S', '9C', '8D'], ['9C']],
    fusiones: { 0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  let r = C.fusionar(e, idsDe(e, 0, ['3S', '3C', '3S']));
  assert(!r.ok, 'debió rechazar 3 negros sin salir');
  // Y al salir: mano de solo 3 negros con canasta en mesa.
  const e2 = C._debug.crearManoPersonalizada({
    manos: [['3S', '3C', '3S'], ['9C']],
    fusiones: { 0: { A: ['AS', 'AH', 'AD', 'AC', 'AS', 'AH', 'AD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  e2.players[0].fusionoAntesDelTurno = true;
  r = C.fusionar(e2, idsDe(e2, 0, ['3S', '3C', '3S']));
  assert(r.ok && r.salio, JSON.stringify(r));
});

prueba('Robar un 3 rojo lo aparta y repone la carta', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['9C', '8D'], ['9C']],
    mazo: ['5S', '3H', '7D'], // se roba desde el final: 7D y luego 3H -> repone 5S
    fase: 'robar'
  });
  const antes = e.players[0].hand.length;
  const r = C.robarDelMazo(e);
  assert(r.ok, r.error);
  assert.strictEqual(e.players[0].redThrees.length, 1);
  assert.strictEqual(e.players[0].hand.length, antes + 2);
  assert(!e.players[0].hand.some(c => C.esTresRojo(c)));
});

prueba('Mazo agotado sin tomar el pozo: la mano termina sin bonus de salida', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['9C', '8D'], ['9C', 'QD']],
    mazo: [], pozo: ['4D'], fase: 'robar',
    fusiones: { 0: { K: ['KS', 'KH', 'KD'] } }, fusionado: [true, false]
  });
  const r = C.robarDelMazo(e);
  assert(r.ok && r.finDeMano, JSON.stringify(r));
  assert.strictEqual(e.phase, 'fin');
  assert.strictEqual(e.resultado.desglose[0].salida, 0);
  assert.strictEqual(e.resultado.desglose[1].salida, 0);
});

// ---------- Niveles de dificultad y pista ----------
prueba('Nivel fácil: la CPU nunca toma el pozo aunque pueda y le convenga', () => {
  // Pozo grande (6 cartas) con pareja natural en mano: en normal/difícil
  // la CPU lo tomaría; en fácil debe robar del mazo.
  const e = C._debug.crearManoPersonalizada({
    manos: [['4C'], ['7S', '7H', '9S', '9H', '9D', 'KC', 'QD']],
    pozo: ['5S', '6S', '8S', '10S', 'QS', '7D'],
    mazo: ['AS', 'AH', 'AD', 'AC', 'KS', 'KH'],
    fusionado: [false, true], turno: 1, fase: 'robar'
  });
  const rng = C.crearRng(5);
  const r = C.cpuTurnoConNivel(e, rng, 'facil');
  assert(r.ok, r.error);
  // El pozo original (6 cartas) sigue completo bajo el descarte de la CPU:
  // solo creció en 1 (su descarte), no lo tomó.
  assert.strictEqual(e.pile.length, 7, 'el pozo debió conservarse y crecer solo con el descarte');
  assert.strictEqual(C.codigoCarta(e.pile[5]), '7D', 'la carta superior original sigue en el pozo');
});

prueba('Niveles normal y difícil completan turnos legales con invariantes', () => {
  for (const nivel of ['normal', 'dificil']) {
    const partida = C.crearPartida();
    const rng = C.crearRng(77);
    let e = C.nuevaMano(partida, rng);
    let guardia = 0;
    while (e.phase !== 'fin' && guardia++ < 500) {
      const r = C.cpuTurnoConNivel(e, rng, nivel);
      assert(r.ok, nivel + ': ' + r.error);
      assert.deepStrictEqual(C.validarInvariantes(e), []);
    }
    assert.strictEqual(e.phase, 'fin', nivel + ': la mano no terminó');
  }
});

prueba('Pista en fase de robo: sugiere tomar un pozo que compensa', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['7S', '7H', '9S', 'KC', 'QD', '4S'], ['4C']],
    pozo: ['5S', '6S', '8S', '10S', 'QS', '7D'],
    mazo: ['AS', 'AH'],
    fusionado: [true, false], turno: 0, fase: 'robar'
  });
  const s = C.sugerirJugada(e, 0);
  assert.strictEqual(s.tipo, 'tomar-pozo');
  assert.strictEqual(s.ids.length, 2);
  // La jugada sugerida es legal de verdad:
  const r = C.tomarPozo(e, { tipo: s.opcion });
  assert(r.ok, r.error);
});

prueba('Pista en fase de robo: con pozo pobre sugiere robar del mazo', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['9S', 'KC', 'QD', '4S'], ['4C']],
    pozo: ['7D'], mazo: ['AS', 'AH'],
    fusionado: [true, false], turno: 0, fase: 'robar'
  });
  const s = C.sugerirJugada(e, 0);
  assert.strictEqual(s.tipo, 'robar');
  assert.strictEqual(s.ids.length, 0);
});

prueba('Pista de fusión inicial: propone grupos que el motor acepta', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['AS', 'AH', 'AD', 'KS', 'KH', 'KD', '9C', '4S'], ['4C']],
    mazo: ['5S'], fase: 'jugar', puntajesPrevios: [0, 0]
  });
  const s = C.sugerirJugada(e, 0);
  assert.strictEqual(s.tipo, 'fusion-inicial');
  const r = C.fusionInicial(e, s.grupos);
  assert(r.ok, r.error);
});

prueba('Pista de fusión: sugiere añadir a una fusión en mesa y el motor lo acepta', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['KS', 'KH', '9C', '4S'], ['4C']],
    fusiones: { 0: { K: ['KD', 'KC', 'KS'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  const s = C.sugerirJugada(e, 0);
  assert.strictEqual(s.tipo, 'fusionar');
  assert.strictEqual(s.destino, 'K');
  const r = C.fusionar(e, s.ids, s.destino);
  assert(r.ok, r.error);
});

prueba('Pista sin fusiones posibles: sugiere un descarte que está en la mano', () => {
  const e = C._debug.crearManoPersonalizada({
    manos: [['9C', '4S', '6D', '8H'], ['4C']],
    fusiones: { 0: { K: ['KS', 'KH', 'KD'] } },
    fusionado: [true, false], fase: 'jugar'
  });
  const s = C.sugerirJugada(e, 0);
  assert.strictEqual(s.tipo, 'descartar');
  assert.strictEqual(s.ids.length, 1);
  assert(e.players[0].hand.some(c => c.uid === s.ids[0]));
  const r = C.descartar(e, s.ids[0]);
  assert(r.ok, r.error);
});

// ---------- Partidas completas ----------
prueba('Partidas completas CPU vs CPU hasta 5000 con invariantes (5 semillas)', () => {
  const resumenes = [];
  for (const semilla of [7, 42, 123, 2026, 9999]) {
    resumenes.push(jugarPartida(semilla, (e, rng) => {
      const r = C.cpuTurno(e, rng);
      assert(r.ok, 'cpuTurno falló: ' + r.error);
    }, 'CPU semilla ' + semilla));
  }
  const totManos = resumenes.reduce((s, r) => s + r.manos, 0);
  const totTurnos = resumenes.reduce((s, r) => s + r.turnosTotales, 0);
  console.log('        CPU vs CPU: 5 partidos, ' + totManos + ' manos, ' + totTurnos + ' turnos verificados');
});

prueba('Partidas completas con niveles mezclados (fácil vs difícil) terminan', () => {
  for (const semilla of [11, 222]) {
    const r = jugarPartida(semilla, (e, rng) => {
      const nivel = e.turn === 0 ? 'facil' : 'dificil';
      const res = C.cpuTurnoConNivel(e, rng, nivel);
      assert(res.ok, 'cpuTurnoConNivel ' + nivel + ' falló: ' + res.error);
    }, 'Niveles semilla ' + semilla);
    assert(r.manos >= 1);
  }
});

prueba('Partidas con movimientos aleatorios legales (3 semillas)', () => {
  let totTurnos = 0;
  for (const semilla of [3, 555, 31337]) {
    const r = jugarPartida(semilla, turnoAleatorio, 'Aleatorio semilla ' + semilla);
    totTurnos += r.turnosTotales;
  }
  console.log('        Aleatorio: 3 partidos, ' + totTurnos + ' turnos verificados');
});

console.log('\nResultado: ' + pasadas + ' pasadas, ' + falladas + ' falladas');
process.exit(falladas ? 1 : 0);

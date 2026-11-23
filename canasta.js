/*
 * canasta.js — Motor de reglas de la Canasta clásica (2 jugadores).
 * Puro, sin DOM. Exporta UMD: window.Canasta en el navegador y
 * module.exports en Node (para las pruebas).
 *
 * Reglas implementadas (variante clásica de 2 jugadores):
 *  - Mazo de 108 cartas (2 barajas de 52 + 4 comodines). Comodines:
 *    los jokers y todos los 2. Valores: comodín 50; A y 2 = 20;
 *    K, Q, J, 10, 9, 8 = 10; 7, 6, 5, 4 y 3 negro = 5. 3 rojo = bonus 100.
 *  - Reparto de 11 cartas. La carta inicial del pozo: si es 3 rojo o
 *    comodín se cubre y se voltea otra; el pozo nace congelado si entre
 *    las volteadas hubo un comodín o un 3 rojo.
 *  - Turno: robar 2 del mazo o tomar el pozo completo; fusionar; descartar 1.
 *  - Pozo congelado para un jugador mientras no haya hecho su fusión
 *    inicial, y para todos cuando se descarta un comodín (hasta que
 *    alguien lo tome). Congelado => solo se toma con pareja natural.
 *    No congelado => pareja natural, natural + comodín, o que la carta
 *    superior encaje en una fusión propia ya en mesa.
 *  - Un 3 negro en la parte superior del pozo lo bloquea para el
 *    siguiente jugador (debe robar del mazo).
 *  - Fusión inicial con mínimo según el puntaje del partido:
 *    negativo 15; 0-1495: 50; 1500-2995: 90; 3000+: 120.
 *  - Fusiones de 3 a 7 cartas del mismo valor; los comodines nunca
 *    superan a las naturales. Canasta natural 500, mixta 300, de
 *    comodines 2000. Fusión cerrada (7) no acepta más cartas.
 *  - 3 rojos: se apartan y se repone la carta al robarlos o recibirlos
 *    en el reparto; valen +100 si el jugador fusionó en la mano, -100
 *    si no fusionó nada.
 *  - 3 negros: solo se fusionan (3 o 4, sin comodines) en el turno en
 *    que el jugador sale.
 *  - Salir: requiere al menos una canasta. Bonus 100; salida oculta
 *    (sin haber fusionado antes en la mano) 200.
 *  - Si el mazo se agota y el jugador en turno no toma el pozo, la mano
 *    termina y se puntúa sin bonus de salida.
 *  - Partido a 5000 puntos.
 */
(function (global) {
  'use strict';

  // ---------------- Constantes ----------------
  var PALOS = ['S', 'H', 'D', 'C'];
  var SIMBOLO_PALO = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var PALO_ROJO = { H: true, D: true };
  var VALORES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  var PUNTOS_OBJETIVO = 5000;

  // ---------------- Cartas ----------------
  function esComodin(c) { return c.rank === 'JOKER' || c.rank === '2'; }
  function esTresRojo(c) { return c.rank === '3' && !!PALO_ROJO[c.suit]; }
  function esTresNegro(c) { return c.rank === '3' && !PALO_ROJO[c.suit]; }
  function esNatural(c) { return !esComodin(c); }

  function valorCarta(c) {
    if (c.rank === 'JOKER') return 50;
    if (c.rank === 'A' || c.rank === '2') return 20;
    if (['K', 'Q', 'J', '10', '9', '8'].indexOf(c.rank) >= 0) return 10;
    return 5; // 7, 6, 5, 4 y 3 (el 3 rojo no se puntúa como carta)
  }
  function puntosDeCartas(cartas) {
    return cartas.reduce(function (s, c) { return s + valorCarta(c); }, 0);
  }
  function codigoCarta(c) { return c.rank === 'JOKER' ? 'JOKER' : c.rank + c.suit; }

  function crearMazo() {
    var mazo = [], uid = 1, copia, p, v, i;
    for (copia = 0; copia < 2; copia++) {
      for (p = 0; p < PALOS.length; p++)
        for (v = 0; v < VALORES.length; v++)
          mazo.push({ uid: uid++, rank: VALORES[v], suit: PALOS[p] });
      for (i = 0; i < 2; i++) mazo.push({ uid: uid++, rank: 'JOKER', suit: null });
    }
    return mazo; // 108
  }

  // RNG con semilla (mulberry32) para partidas reproducibles en pruebas.
  function crearRng(semilla) {
    var a = (semilla >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function barajar(cartas, rng) {
    for (var i = cartas.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = cartas[i]; cartas[i] = cartas[j]; cartas[j] = t;
    }
    return cartas;
  }

  // ---------------- Partido y mano ----------------
  function crearPartida() {
    return { puntajes: [0, 0], manoNumero: 1, repartidor: 0, terminada: false, ganador: null };
  }
  function minimoInicial(puntaje) {
    if (puntaje < 0) return 15;
    if (puntaje < 1500) return 50;
    if (puntaje < 3000) return 90;
    return 120;
  }

  function nuevoJugador() {
    return {
      hand: [],            // cartas en mano
      melds: {},           // rank|'WILD' -> [cartas]
      redThrees: [],       // 3 rojos apartados
      hasMelded: false,    // ya hizo su fusión inicial en esta mano
      fusionoAntesDelTurno: false // foto al inicio del turno (salida oculta)
    };
  }

  function registrar(estado, idx, texto) {
    estado.log.push({ jugador: idx, texto: texto });
    if (estado.log.length > 60) estado.log.splice(0, estado.log.length - 60);
  }

  function nuevaMano(partida, rng) {
    var mazo = barajar(crearMazo(), rng);
    var estado = {
      players: [nuevoJugador(), nuevoJugador()],
      stock: mazo,
      pile: [],
      pileFrozen: false,
      turn: 1 - partida.repartidor, // empieza quien no reparte
      phase: 'robar', // robar -> jugar -> fin
      puntajesPrevios: partida.puntajes.slice(),
      log: [],
      resultado: null,
      rng: rng
    };
    var i, j, c;
    for (i = 0; i < 11; i++)
      for (j = 0; j < 2; j++)
        estado.players[j].hand.push(estado.stock.pop());
    // 3 rojos del reparto: se apartan y se reponen.
    for (j = 0; j < 2; j++) apartarTresRojos(estado, j, true);
    // Carta inicial del pozo.
    var congelado = false;
    while (true) {
      c = estado.stock.pop();
      estado.pile.push(c);
      if (esTresRojo(c) || esComodin(c)) { congelado = true; continue; }
      break;
    }
    estado.pileFrozen = congelado;
    registrar(estado, -1, 'Mano ' + partida.manoNumero + ': se repartieron 11 cartas por jugador.' +
      (congelado ? ' El pozo nace congelado.' : ''));
    return estado;
  }

  // Mueve los 3 rojos de la mano del jugador a su pila de bonus.
  // Si reponer es true, roba repuestos del mazo (reparto y robo del mazo).
  function apartarTresRojos(estado, idx, reponer) {
    var p = estado.players[idx], i = 0, c;
    while (i < p.hand.length) {
      c = p.hand[i];
      if (esTresRojo(c)) {
        p.hand.splice(i, 1);
        p.redThrees.push(c);
        registrar(estado, idx, 'apartó un 3 rojo (bonus) y repuso carta.');
        if (reponer) {
          while (estado.stock.length) {
            var r = estado.stock.pop();
            if (esTresRojo(r)) { p.redThrees.push(r); continue; }
            p.hand.push(r); break;
          }
        }
      } else i++;
    }
  }

  // ---------------- Fusiones: utilidades ----------------
  function cartasDeFusiones(jugador) {
    var out = [];
    Object.keys(jugador.melds).forEach(function (k) { out = out.concat(jugador.melds[k]); });
    return out;
  }
  function contarCanastas(jugador) {
    var n = 0;
    Object.keys(jugador.melds).forEach(function (k) {
      if (jugador.melds[k].length === 7) n++;
    });
    return n;
  }
  function tipoCanasta(clave, cartas) {
    if (!cartas || cartas.length !== 7) return null;
    if (clave === 'WILD') return 'comodines';
    return cartas.some(esComodin) ? 'mixta' : 'natural';
  }
  function bonusCanasta(clave, cartas) {
    var t = tipoCanasta(clave, cartas);
    if (t === 'natural') return 500;
    if (t === 'mixta') return 300;
    if (t === 'comodines') return 2000;
    return 0;
  }

  // Analiza un grupo de cartas que se quiere fusionar como fusión NUEVA.
  // Devuelve {ok, clave, naturales, comodines} o {ok:false, error}.
  function analizarGrupoNuevo(cartas) {
    if (!cartas || cartas.length < 3)
      return { ok: false, error: 'Una fusión necesita al menos 3 cartas.' };
    if (cartas.length > 7)
      return { ok: false, error: 'Una fusión no puede tener más de 7 cartas.' };
    var comodines = cartas.filter(esComodin);
    var naturales = cartas.filter(esNatural);
    if (naturales.length === 0)
      return { ok: true, clave: 'WILD', naturales: 0, comodines: comodines.length };
    var rango = naturales[0].rank;
    if (!naturales.every(function (c) { return c.rank === rango; }))
      return { ok: false, error: 'Todas las cartas naturales de una fusión deben ser del mismo valor.' };
    if (rango === '3') {
      // Solo 3 negros, sin comodines, y su uso se valida fuera (solo al salir).
      if (comodines.length > 0)
        return { ok: false, error: 'Los 3 negros se fusionan sin comodines.' };
      if (naturales.some(function (c) { return !esTresNegro(c); }))
        return { ok: false, error: 'Los 3 rojos nunca se fusionan.' };
      return { ok: true, clave: '3N', naturales: naturales.length, comodines: 0, esTresNegros: true };
    }
    if (comodines.length > naturales.length)
      return { ok: false, error: 'Los comodines no pueden superar en número a las cartas naturales de la fusión.' };
    return { ok: true, clave: rango, naturales: naturales.length, comodines: comodines.length };
  }

  // Valida el tamaño de mano que quedaría tras fusionar (regla anti-bloqueo):
  // debe quedar >= 2 cartas, o 0/1 solo si el jugador ya puede salir (canasta).
  function validarManoRestante(jugador, cartasQueSalen, canastasTrasJugada) {
    var restantes = jugador.hand.length - cartasQueSalen;
    if (restantes >= 2) return { ok: true };
    if (restantes === 0)
      return canastasTrasJugada >= 1 ? { ok: true, sale: true }
        : { ok: false, error: 'No puedes quedarte sin cartas: para salir necesitas al menos una canasta.' };
    // restantes === 1: esa carta será el descarte de salida; exige canasta.
    return canastasTrasJugada >= 1 ? { ok: true }
      : { ok: false, error: 'Te quedarías con una sola carta y sin canasta: no podrías descartarla para salir. Fusiona menos cartas o completa una canasta.' };
  }

  function quitarDeMano(jugador, ids) {
    var quitadas = [];
    ids.forEach(function (id) {
      var i = jugador.hand.findIndex(function (c) { return c.uid === id; });
      if (i >= 0) quitadas.push(jugador.hand.splice(i, 1)[0]);
    });
    return quitadas;
  }
  function cartasPorIds(jugador, ids) {
    return ids.map(function (id) {
      return jugador.hand.find(function (c) { return c.uid === id; });
    });
  }
  function hayDuplicados(ids) {
    var vistos = {};
    for (var i = 0; i < ids.length; i++) {
      if (vistos[ids[i]]) return true;
      vistos[ids[i]] = true;
    }
    return false;
  }
  function error(msg) { return { ok: false, error: msg }; }

  // ---------------- Pozo ----------------
  // Carta que hay que empatar para tomar el pozo: la última que no sea
  // comodín ni 3 rojo (un comodín descartado se coloca cruzado encima).
  function cartaParaEmpatar(estado) {
    for (var i = estado.pile.length - 1; i >= 0; i--) {
      var c = estado.pile[i];
      if (!esComodin(c) && !esTresRojo(c)) return { carta: c, indice: i };
    }
    return null;
  }
  function pozoCongeladoPara(estado, idx) {
    return estado.pileFrozen || !estado.players[idx].hasMelded;
  }

  function puedeRobarPozo(estado, idx) {
    var jugador = estado.players[idx];
    var res = { puede: false, congelado: pozoCongeladoPara(estado, idx), opciones: [], motivo: '' };
    if (estado.phase !== 'robar') { res.motivo = 'Solo puedes tomar el pozo al inicio de tu turno.'; return res; }
    if (!estado.pile.length) { res.motivo = 'El pozo está vacío.'; return res; }
    var arriba = estado.pile[estado.pile.length - 1];
    if (esTresNegro(arriba)) {
      res.motivo = 'Un 3 negro tapa el pozo: este turno debes robar del mazo.';
      return res;
    }
    var objetivo = cartaParaEmpatar(estado);
    if (!objetivo) { res.motivo = 'No hay carta válida para empatar en el pozo.'; return res; }
    if (esTresNegro(objetivo.carta)) {
      res.motivo = 'La carta a empatar es un 3 negro: el pozo está bloqueado.';
      return res;
    }
    var rango = objetivo.carta.rank;
    var naturales = jugador.hand.filter(function (c) { return esNatural(c) && c.rank === rango; });
    var comodines = jugador.hand.filter(esComodin);
    if (naturales.length >= 2)
      res.opciones.push({ tipo: 'pareja', ids: [naturales[0].uid, naturales[1].uid], rango: rango });
    if (!res.congelado) {
      if (naturales.length >= 1 && comodines.length >= 1)
        res.opciones.push({ tipo: 'naturalComodin', ids: [naturales[0].uid, comodines[0].uid], rango: rango });
      var fusion = jugador.melds[rango];
      if (fusion && fusion.length < 7)
        res.opciones.push({ tipo: 'fusion', ids: [], rango: rango });
    }
    res.puede = res.opciones.length > 0;
    if (!res.puede)
      res.motivo = res.congelado
        ? 'El pozo está congelado para ti: necesitas una pareja natural del valor de la carta superior.'
        : 'No tienes combinación para tomar el pozo (pareja natural, natural + comodín o fusión de ese valor en mesa).';
    res.rangoObjetivo = rango;
    res.cartasEnPozo = estado.pile.length;
    return res;
  }

  // ---------------- Acciones del turno ----------------
  function fotoInicioTurno(estado) {
    var j = estado.players[estado.turn];
    j.fusionoAntesDelTurno = j.hasMelded;
  }

  function robarDelMazo(estado) {
    if (estado.phase !== 'robar') return error('Ya robaste en este turno.');
    fotoInicioTurno(estado);
    var idx = estado.turn, jugador = estado.players[idx];
    if (!estado.stock.length) {
      // Mazo agotado y no toma el pozo: la mano termina.
      finalizarMano(estado, -1, false);
      registrar(estado, -1, 'El mazo se agotó y nadie tomó el pozo: la mano termina.');
      return { ok: true, finDeMano: true };
    }
    var robadas = [], tres = 0, i, c;
    var n = Math.min(2, estado.stock.length);
    for (i = 0; i < n; i++) {
      c = estado.stock.pop();
      if (esTresRojo(c)) {
        jugador.redThrees.push(c); tres++;
        while (estado.stock.length) {
          var r = estado.stock.pop();
          if (esTresRojo(r)) { jugador.redThrees.push(r); tres++; continue; }
          jugador.hand.push(r); robadas.push(r); break;
        }
      } else { jugador.hand.push(c); robadas.push(c); }
    }
    estado.phase = 'jugar';
    registrar(estado, idx, 'robó ' + robadas.length + ' carta(s) del mazo' +
      (tres ? ' y apartó ' + tres + ' tres rojo(s).' : '.'));
    return { ok: true, cartas: robadas, tresRojos: tres };
  }

  function tomarPozo(estado, opcion) {
    if (estado.phase !== 'robar') return error('Solo puedes tomar el pozo al inicio de tu turno.');
    var idx = estado.turn, jugador = estado.players[idx];
    var info = puedeRobarPozo(estado, idx);
    if (!info.puede) return error(info.motivo);
    var elegida = info.opciones.filter(function (o) { return o.tipo === (opcion && opcion.tipo); })[0];
    if (!elegida) return error('Esa forma de tomar el pozo no es válida ahora.');
    // Cartas de la combinación (para naturalComodin se respeta el comodín elegido).
    var idsCombo = elegida.ids.slice();
    if (elegida.tipo === 'naturalComodin' && opcion.comodinId) {
      var nat = jugador.hand.find(function (c) { return esNatural(c) && c.rank === elegida.rango; });
      var com = jugador.hand.find(function (c) { return c.uid === opcion.comodinId && esComodin(c); });
      if (!nat || !com) return error('La combinación elegida ya no está en tu mano.');
      idsCombo = [nat.uid, com.uid];
    }
    var objetivo = cartaParaEmpatar(estado);
    var cartaSup = objetivo.carta;
    var fusionPrevia = jugador.melds[elegida.rango] ? jugador.melds[elegida.rango].slice() : [];
    var cartasCombo = cartasPorIds(jugador, idsCombo);
    if (cartasCombo.some(function (c) { return !c; })) return error('La combinación elegida ya no está en tu mano.');
    var fusionResultante = fusionPrevia.concat(cartasCombo, [cartaSup]);
    if (fusionResultante.length > 7)
      return error('Esa fusión ya tiene ' + fusionPrevia.length + ' cartas: no cabe la carta superior del pozo.');
    var nats = fusionResultante.filter(esNatural).length;
    var coms = fusionResultante.filter(esComodin).length;
    if (coms > nats)
      return error('Los comodines no pueden superar en número a las cartas naturales de la fusión.');
    // Fusión inicial: la combinación (y grupos extra) deben alcanzar el mínimo.
    var gruposExtra = (opcion && opcion.gruposExtra) || [];
    var analisisExtra = [];
    if (!jugador.hasMelded) {
      var puntos = puntosDeCartas(fusionResultante);
      var idsUsados = {};
      idsCombo.forEach(function (id) { idsUsados[id] = true; });
      for (var g = 0; g < gruposExtra.length; g++) {
        var cartasG = cartasPorIds(jugador, gruposExtra[g]);
        if (cartasG.some(function (c) { return !c; }) ||
            gruposExtra[g].some(function (id) { return idsUsados[id]; }))
          return error('Un grupo extra de la fusión inicial no es válido.');
        gruposExtra[g].forEach(function (id) { idsUsados[id] = true; });
        var an = analizarGrupoNuevo(cartasG);
        if (!an.ok) return error(an.error);
        if (an.esTresNegros)
          return error('Los 3 negros solo se fusionan en el turno en que sales.');
        if (jugador.melds[an.clave])
          return error('Ya tienes una fusión de ese valor en la mesa.');
        analisisExtra.push({ clave: an.clave, cartas: cartasG });
        puntos += puntosDeCartas(cartasG);
      }
      var minimo = minimoInicial(estado.puntajesPrevios[idx]);
      if (puntos < minimo)
        return error('Te faltan puntos para la fusión inicial: llevas ' + puntos + ' de ' + minimo +
          '. Añade más fusiones en este turno o roba del mazo.');
      // Los grupos extra que coinciden con la fusión de la combinación se
      // unen a ella: el conjunto debe seguir siendo una fusión legal.
      var porClaveT = {};
      porClaveT[elegida.rango] = fusionResultante;
      analisisExtra.forEach(function (a) {
        porClaveT[a.clave] = (porClaveT[a.clave] || []).concat(a.cartas);
      });
      for (var k2 in porClaveT) {
        if (porClaveT[k2].length > 7)
          return error('La fusión de ' + k2 + ' quedaría con más de 7 cartas.');
        if (k2 !== 'WILD') {
          var nn2 = porClaveT[k2].filter(esNatural).length;
          var cc2 = porClaveT[k2].filter(esComodin).length;
          if (cc2 > nn2)
            return error('Los comodines no pueden superar en número a las cartas naturales de la fusión.');
        }
      }
    }
    // --- Aplicar ---
    fotoInicioTurno(estado);
    quitarDeMano(jugador, idsCombo);
    estado.pile.splice(objetivo.indice, 1);
    jugador.melds[elegida.rango] = fusionResultante;
    analisisExtra.forEach(function (a) {
      quitarDeMano(jugador, a.cartas.map(function (c) { return c.uid; }));
      jugador.melds[a.clave] = (jugador.melds[a.clave] || []).concat(a.cartas);
    });
    jugador.hasMelded = true;
    var resto = estado.pile.splice(0, estado.pile.length);
    var tres = 0;
    resto.forEach(function (c) {
      if (esTresRojo(c)) { jugador.redThrees.push(c); tres++; }
      else jugador.hand.push(c);
    });
    estado.pileFrozen = false;
    estado.phase = 'jugar';
    registrar(estado, idx, 'tomó el pozo (' + (resto.length + 1) + ' cartas) con ' +
      (elegida.tipo === 'pareja' ? 'pareja natural' :
       elegida.tipo === 'naturalComodin' ? 'natural + comodín' : 'su fusión en mesa') + '.');
    return { ok: true, cartasGanadas: resto.length + 1, tresRojos: tres };
  }

  function fusionInicial(estado, grupos) {
    if (estado.phase !== 'jugar') return error('Primero roba o toma el pozo.');
    var idx = estado.turn, jugador = estado.players[idx];
    if (jugador.hasMelded) return error('Ya hiciste tu fusión inicial en esta mano.');
    if (!grupos || !grupos.length) return error('Selecciona al menos un grupo para fusionar.');
    if (grupos.some(function (g) { return hayDuplicados(g); }))
      return error('Hay cartas repetidas en los grupos seleccionados.');
    var idsUsados = {}, analisis = [], puntos = 0, totalCartas = 0;
    for (var g = 0; g < grupos.length; g++) {
      var cartasG = cartasPorIds(jugador, grupos[g]);
      if (cartasG.some(function (c) { return !c; }) ||
          grupos[g].some(function (id) { return idsUsados[id]; }))
        return error('Hay cartas repetidas o que ya no están en tu mano.');
      grupos[g].forEach(function (id) { idsUsados[id] = true; });
      var an = analizarGrupoNuevo(cartasG);
      if (!an.ok) return error(an.error);
      analisis.push({ clave: an.clave, cartas: cartasG, esTresNegros: !!an.esTresNegros });
      puntos += puntosDeCartas(cartasG);
      totalCartas += cartasG.length;
    }
    // Grupos del mismo valor se unen en una sola fusión: valida el conjunto.
    var porClave = {};
    analisis.forEach(function (a) {
      porClave[a.clave] = (porClave[a.clave] || []).concat(a.cartas);
    });
    for (var k in porClave) {
      if (porClave[k].length > 7)
        return error('La fusión de ' + k + ' quedaría con ' + porClave[k].length + ' cartas: el máximo es 7.');
      if (k !== 'WILD' && k !== '3N') {
        var nn = porClave[k].filter(esNatural).length;
        var cc = porClave[k].filter(esComodin).length;
        if (cc > nn)
          return error('Los comodines no pueden superar en número a las cartas naturales de la fusión.');
      }
    }
    var minimo = minimoInicial(estado.puntajesPrevios[idx]);
    if (puntos < minimo)
      return error('Te faltan puntos para la fusión inicial: llevas ' + puntos + ' de ' + minimo + '.');
    var canastas = analisis.filter(function (a) { return a.cartas.length === 7; }).length;
    var tieneTresNegros = analisis.some(function (a) { return a.esTresNegros; });
    if (tieneTresNegros && !(jugador.hand.length - totalCartas === 0 && canastas >= 1))
      return error('Los 3 negros solo se fusionan en el turno en que sales, completando canasta y quedándote sin cartas.');
    var val = validarManoRestante(jugador, totalCartas, canastas);
    if (!val.ok) return error(val.error);
    analisis.forEach(function (a) {
      quitarDeMano(jugador, a.cartas.map(function (c) { return c.uid; }));
      jugador.melds[a.clave] = (jugador.melds[a.clave] || []).concat(a.cartas);
    });
    jugador.hasMelded = true;
    registrar(estado, idx, 'hizo su fusión inicial con ' + puntos + ' puntos.');
    if (val.sale) return salir(estado);
    return { ok: true, puntos: puntos };
  }

  // destino opcional: rank destino o 'WILD' cuando la selección son solo comodines.
  function fusionar(estado, ids, destino) {
    if (estado.phase !== 'jugar') return error('Primero roba o toma el pozo.');
    var idx = estado.turn, jugador = estado.players[idx];
    if (!jugador.hasMelded)
      return error('Es tu primera fusión de la mano: debe cumplir el mínimo inicial de ' +
        minimoInicial(estado.puntajesPrevios[idx]) + ' puntos. Usa la fusión inicial.');
    if (!ids || !ids.length) return error('Selecciona las cartas que quieres fusionar.');
    if (hayDuplicados(ids)) return error('La selección tiene cartas repetidas.');
    var cartas = cartasPorIds(jugador, ids);
    if (cartas.some(function (c) { return !c; })) return error('Hay cartas que ya no están en tu mano.');
    var comodines = cartas.filter(esComodin);
    var naturales = cartas.filter(esNatural);

    // Caso especial: 3 negros para salir.
    if (naturales.length && naturales.every(esTresNegro) && comodines.length === 0) {
      if (cartas.length < 3 || cartas.length > 4)
        return error('La fusión de 3 negros debe tener 3 o 4 cartas.');
      if (jugador.hand.length - cartas.length !== 0)
        return error('Los 3 negros solo se fusionan en el turno en que sales (debes quedarte sin cartas).');
      if (contarCanastas(jugador) < 1)
        return error('Para salir necesitas al menos una canasta.');
      quitarDeMano(jugador, ids);
      jugador.melds['3N'] = cartas;
      registrar(estado, idx, 'fusionó sus 3 negros para salir.');
      return salir(estado);
    }

    var clave;
    if (naturales.length === 0) {
      clave = destino && destino !== 'WILD' ? destino : 'WILD';
      if (clave !== 'WILD') {
        // Añadir solo comodines a una fusión existente de ese valor.
        if (!jugador.melds[clave]) return error('No tienes una fusión de ese valor en la mesa.');
      }
    } else {
      var rango = naturales[0].rank;
      if (!naturales.every(function (c) { return c.rank === rango; }))
        return error('Todas las cartas naturales de una fusión deben ser del mismo valor.');
      if (rango === '3')
        return error('Los 3 negros solo se fusionan solos (3 o 4) en el turno en que sales.');
      clave = rango;
    }
    var previa = jugador.melds[clave] ? jugador.melds[clave].slice() : [];
    if (previa.length >= 7)
      return error('Esa fusión ya es una canasta cerrada: no acepta más cartas.');
    var resultante = previa.concat(cartas);
    if (resultante.length > 7)
      return error('La fusión quedaría con ' + resultante.length + ' cartas: el máximo es 7.');
    if (!previa.length && resultante.length < 3)
      return error('Una fusión nueva necesita al menos 3 cartas.');
    if (clave !== 'WILD') {
      var nats = resultante.filter(esNatural).length;
      var coms = resultante.filter(esComodin).length;
      if (coms > nats)
        return error('Los comodines no pueden superar en número a las cartas naturales de la fusión.');
    }
    var canastasTras = contarCanastas(jugador) +
      (resultante.length === 7 && previa.length !== 7 ? 1 : 0);
    var val = validarManoRestante(jugador, cartas.length, canastasTras);
    if (!val.ok) return error(val.error);
    quitarDeMano(jugador, ids);
    jugador.melds[clave] = resultante;
    registrar(estado, idx, 'fusionó ' + cartas.length + ' carta(s)' +
      (resultante.length === 7 ? ': ¡canasta ' + tipoCanasta(clave, resultante) + '!' : '.'));
    if (val.sale) return salir(estado);
    return { ok: true };
  }

  function descartar(estado, id) {
    if (estado.phase !== 'jugar') return error('Primero roba o toma el pozo.');
    var idx = estado.turn, jugador = estado.players[idx];
    var carta = jugador.hand.find(function (c) { return c.uid === id; });
    if (!carta) return error('Esa carta no está en tu mano.');
    if (jugador.hand.length === 1 && contarCanastas(jugador) < 1)
      return error('No puedes descartar tu última carta: para salir necesitas al menos una canasta.');
    quitarDeMano(jugador, [id]);
    estado.pile.push(carta);
    if (esComodin(carta)) {
      estado.pileFrozen = true;
      registrar(estado, idx, 'descartó un comodín: el pozo queda congelado.');
    } else {
      registrar(estado, idx, 'descartó ' + codigoCarta(carta) + '.');
    }
    if (!jugador.hand.length) return salir(estado);
    estado.turn = 1 - idx;
    estado.phase = 'robar';
    return { ok: true };
  }

  function salir(estado) {
    var idx = estado.turn, jugador = estado.players[idx];
    var oculta = !jugador.fusionoAntesDelTurno;
    registrar(estado, idx, oculta ? '¡salió de forma oculta!' : '¡salió!');
    finalizarMano(estado, idx, oculta);
    return { ok: true, salio: true, oculta: oculta };
  }

  // ---------------- Puntuación ----------------
  function puntuarMano(estado, salioIdx, oculta) {
    return estado.players.map(function (jugador, i) {
      var puntosFusiones = 0, bonusCanastas = 0;
      Object.keys(jugador.melds).forEach(function (k) {
        puntosFusiones += puntosDeCartas(jugador.melds[k]);
        bonusCanastas += bonusCanasta(k, jugador.melds[k]);
      });
      var tresRojos = jugador.redThrees.length * (jugador.hasMelded ? 100 : -100);
      var bonusSalida = i === salioIdx ? (oculta ? 200 : 100) : 0;
      var penalizacion = puntosDeCartas(jugador.hand);
      return {
        fusiones: puntosFusiones,
        canastas: bonusCanastas,
        tresRojos: tresRojos,
        salida: bonusSalida,
        enMano: -penalizacion,
        total: puntosFusiones + bonusCanastas + tresRojos + bonusSalida - penalizacion
      };
    });
  }

  function finalizarMano(estado, salioIdx, oculta) {
    estado.phase = 'fin';
    estado.resultado = {
      desglose: puntuarMano(estado, salioIdx, oculta),
      salio: salioIdx,
      oculta: !!oculta
    };
    return estado.resultado;
  }

  function cerrarMano(partida, estado) {
    if (!estado.resultado) throw new Error('La mano aún no ha terminado.');
    partida.puntajes[0] += estado.resultado.desglose[0].total;
    partida.puntajes[1] += estado.resultado.desglose[1].total;
    var resumen = {
      puntajes: partida.puntajes.slice(),
      manoNumero: partida.manoNumero,
      terminada: false, ganador: null
    };
    if ((partida.puntajes[0] >= PUNTOS_OBJETIVO || partida.puntajes[1] >= PUNTOS_OBJETIVO) &&
        partida.puntajes[0] !== partida.puntajes[1]) {
      partida.terminada = true;
      partida.ganador = partida.puntajes[0] > partida.puntajes[1] ? 0 : 1;
      resumen.terminada = true;
      resumen.ganador = partida.ganador;
    } else {
      partida.manoNumero++;
      partida.repartidor = 1 - partida.repartidor;
    }
    return resumen;
  }

  // ---------------- Invariantes (pruebas) ----------------
  function validarInvariantes(estado) {
    var problemas = [], vistos = {}, total = 0;
    function contar(c, donde) {
      total++;
      if (vistos[c.uid]) problemas.push('Carta duplicada uid ' + c.uid + ' en ' + donde);
      vistos[c.uid] = true;
    }
    estado.stock.forEach(function (c) { contar(c, 'mazo'); });
    estado.pile.forEach(function (c) { contar(c, 'pozo'); });
    estado.players.forEach(function (j, i) {
      j.hand.forEach(function (c) {
        contar(c, 'mano ' + i);
        if (esTresRojo(c)) problemas.push('Hay un 3 rojo en la mano del jugador ' + i);
      });
      j.redThrees.forEach(function (c) { contar(c, 'tres rojos ' + i); });
      Object.keys(j.melds).forEach(function (k) {
        var m = j.melds[k];
        m.forEach(function (c) { contar(c, 'fusión ' + k + ' de ' + i); });
        if (m.length < 3 || m.length > 7)
          problemas.push('Fusión ' + k + ' del jugador ' + i + ' con tamaño ilegal: ' + m.length);
        if (k === 'WILD') {
          if (!m.every(esComodin)) problemas.push('Fusión de comodines con cartas naturales (jugador ' + i + ')');
        } else if (k === '3N') {
          if (!m.every(esTresNegro)) problemas.push('Fusión 3N con cartas que no son 3 negros (jugador ' + i + ')');
        } else {
          var nats = m.filter(esNatural), coms = m.filter(esComodin);
          if (!nats.every(function (c) { return c.rank === k; }))
            problemas.push('Fusión ' + k + ' con naturales de otro valor (jugador ' + i + ')');
          if (coms.length > nats.length)
            problemas.push('Fusión ' + k + ' con más comodines que naturales (jugador ' + i + ')');
        }
      });
    });
    if (total !== 108) problemas.push('Total de cartas en el sistema: ' + total + ' (deben ser 108)');
    return problemas;
  }

  // ---------------- Ayudantes de estrategia (CPU y pruebas) ----------------
  function agruparMano(hand) {
    var naturales = {}, comodines = [], tresNegros = [];
    hand.forEach(function (c) {
      if (esComodin(c)) comodines.push(c);
      else if (esTresNegro(c)) tresNegros.push(c);
      else {
        if (!naturales[c.rank]) naturales[c.rank] = [];
        naturales[c.rank].push(c);
      }
    });
    return { naturales: naturales, comodines: comodines, tresNegros: tresNegros };
  }

  // Busca grupos para la fusión inicial que alcancen el mínimo (greedy).
  // Devuelve array de grupos (arrays de cartas) o null si no alcanza.
  function buscarGruposIniciales(hand, minimo) {
    var g = agruparMano(hand);
    var comodines = g.comodines.slice();
    var candidatos = [];
    Object.keys(g.naturales).forEach(function (rango) {
      var ns = g.naturales[rango];
      if (ns.length >= 3) candidatos.push(ns.slice(0, 7));
    });
    Object.keys(g.naturales).forEach(function (rango) {
      var ns = g.naturales[rango];
      if (ns.length === 2 && comodines.length) {
        candidatos.push([ns[0], ns[1], comodines.shift()]);
      }
    });
    if (comodines.length >= 3) candidatos.push(comodines.slice(0, 7));
    candidatos.sort(function (a, b) { return puntosDeCartas(b) - puntosDeCartas(a); });
    var grupos = [], puntos = 0;
    for (var i = 0; i < candidatos.length && puntos < minimo; i++) {
      grupos.push(candidatos[i]);
      puntos += puntosDeCartas(candidatos[i]);
    }
    return puntos >= minimo ? grupos : null;
  }

  // ---------------- CPU ----------------
  function cpuFusionar(estado, rng) {
    var idx = estado.turn, jugador = estado.players[idx];
    var minimo = minimoInicial(estado.puntajesPrevios[idx]);
    var i, r;
    if (!jugador.hasMelded) {
      var grupos = buscarGruposIniciales(jugador.hand, minimo);
      if (grupos) {
        // Evita quedarse con 1 carta sin canasta: retira el grupo menor si hace falta.
        var total = grupos.reduce(function (s, gr) { return s + gr.length; }, 0);
        var restantes = jugador.hand.length - total;
        var hayCanasta = grupos.some(function (gr) { return gr.length === 7; });
        if ((restantes === 1 && !hayCanasta) || (restantes === 0 && !hayCanasta)) {
          grupos = grupos.slice(0, grupos.length - 1);
          if (!grupos.length ||
              grupos.reduce(function (s, gr) { return s + puntosDeCartas(gr); }, 0) < minimo)
            grupos = null;
        }
        if (grupos) {
          var resIni = fusionInicial(estado, grupos.map(function (gr) {
            return gr.map(function (c) { return c.uid; });
          }));
          if (!resIni.ok) { /* si el motor lo rechaza, la CPU sigue sin fusionar */ }
          if (estado.phase === 'fin') return;
        }
      }
      if (!jugador.hasMelded) return;
    }
    // Añadir cartas a fusiones existentes y crear fusiones nuevas.
    var guardia = 0;
    var huboCambio = true;
    while (huboCambio && guardia++ < 12 && estado.phase === 'jugar') {
      huboCambio = false;
      var g = agruparMano(jugador.hand);
      // 1) Completar canastas y añadir naturales a fusiones existentes.
      var claves = Object.keys(jugador.melds);
      for (i = 0; i < claves.length; i++) {
        var clave = claves[i];
        if (clave === 'WILD' || clave === '3N') continue;
        var fusion = jugador.melds[clave];
        if (!fusion || fusion.length >= 7) continue;
        var disp = (g.naturales[clave] || []).slice();
        var ids = [];
        while (disp.length && fusion.length + ids.length < 7) ids.push(disp.shift().uid);
        // Si con un comodín se cierra la canasta y la proporción lo permite, úsalo.
        if (fusion.length + ids.length === 6 && g.comodines.length) {
          var natsF = fusion.filter(esNatural).length + ids.length;
          var comsF = fusion.filter(esComodin).length;
          if (comsF + 1 <= natsF) ids.push(g.comodines[0].uid);
        }
        if (ids.length) {
          r = fusionar(estado, ids, clave);
          if (r.ok) { huboCambio = true; if (estado.phase === 'fin') return; }
        }
      }
      if (huboCambio) continue;
      // 2) Fusiones nuevas con 3+ naturales.
      var rangos = Object.keys(g.naturales);
      for (i = 0; i < rangos.length; i++) {
        var ns = g.naturales[rangos[i]];
        if (ns.length >= 3 && !jugador.melds[rangos[i]]) {
          r = fusionar(estado, ns.slice(0, 7).map(function (c) { return c.uid; }));
          if (r.ok) { huboCambio = true; if (estado.phase === 'fin') return; break; }
        }
      }
      if (huboCambio) continue;
      // 3) Pareja + comodín si sobran comodines.
      for (i = 0; i < rangos.length; i++) {
        var ns2 = g.naturales[rangos[i]];
        if (ns2.length === 2 && g.comodines.length >= 2 && !jugador.melds[rangos[i]]) {
          r = fusionar(estado, [ns2[0].uid, ns2[1].uid, g.comodines[0].uid]);
          if (r.ok) { huboCambio = true; if (estado.phase === 'fin') return; break; }
        }
      }
      if (huboCambio) continue;
      // 4) Muchos comodines acumulados: fusionarlos (valen más en mesa que en mano al cierre).
      if (g.comodines.length >= 5) {
        r = fusionar(estado, g.comodines.slice(0, 7).map(function (c) { return c.uid; }), 'WILD');
        if (r.ok) huboCambio = true;
        if (estado.phase === 'fin') return;
      }
    }
    // 5) Salida con 3 negros: mano compuesta solo por 3 negros y canasta hecha.
    if (estado.phase === 'jugar' && contarCanastas(jugador) >= 1) {
      var g2 = agruparMano(jugador.hand);
      if (jugador.hand.length >= 3 && jugador.hand.length <= 4 &&
          g2.tresNegros.length === jugador.hand.length) {
        fusionar(estado, jugador.hand.map(function (c) { return c.uid; }));
      }
    }
  }

  function cpuElegirDescarte(estado, rng) {
    var idx = estado.turn, jugador = estado.players[idx];
    var rival = estado.players[1 - idx];
    var objetivo = cartaParaEmpatar(estado);
    var rangoPozo = objetivo ? objetivo.carta.rank : null;
    var mejor = null, mejorPunt = Infinity;
    jugador.hand.forEach(function (c) {
      var s = valorCarta(c) + rng() * 12;
      if (esTresNegro(c)) s -= 100;                       // bloquea el pozo al rival
      if (esComodin(c)) s += 90;                          // no regalar comodines
      if (rangoPozo && esNatural(c) && c.rank === rangoPozo) s += 60; // no regalar el pozo
      var mismoValor = jugador.hand.filter(function (o) {
        return o !== c && esNatural(o) && esNatural(c) && o.rank === c.rank;
      }).length;
      if (mismoValor >= 1) s += 40;                       // no romper parejas/grupos
      if (esNatural(c) && jugador.melds[c.rank]) s += 25; // podría sumarla a mi fusión
      if (esNatural(c) && rival.melds[c.rank]) s += 10;
      if (s < mejorPunt) { mejorPunt = s; mejor = c; }
    });
    return mejor;
  }

  function cpuTurno(estado, rng) {
    if (estado.phase !== 'robar') return error('No es el turno de robar de la CPU.');
    var idx = estado.turn, jugador = estado.players[idx];
    var info = puedeRobarPozo(estado, idx);
    var tomo = false;
    if (info.puede) {
      var valorPozo = puntosDeCartas(estado.pile);
      var quiere = estado.pile.length >= 4 || valorPozo >= 50 ||
        (!estado.stock.length && (estado.pile.length >= 3 || valorPozo >= 40));
      if (quiere) {
        var orden = ['pareja', 'fusion', 'naturalComodin'];
        for (var t = 0; t < orden.length && !tomo; t++) {
          var op = info.opciones.filter(function (o) { return o.tipo === orden[t]; })[0];
          if (!op) continue;
          var plan = { tipo: op.tipo };
          if (!jugador.hasMelded) {
            // Grupos extra de la mano (sin las cartas de la combinación) para el mínimo.
            var usadas = {};
            op.ids.forEach(function (id) { usadas[id] = true; });
            var resto = jugador.hand.filter(function (c) { return !usadas[c.uid]; });
            var minimo = minimoInicial(estado.puntajesPrevios[idx]);
            var puntosCombo = puntosDeCartas(op.ids) +
              valorCarta(cartaParaEmpatar(estado).carta);
            if (puntosCombo < minimo) {
              var grupos = buscarGruposIniciales(resto, minimo - puntosCombo);
              if (!grupos) continue; // con esta opción no alcanza el mínimo; prueba otra
              plan.gruposExtra = grupos.map(function (gr) {
                return gr.map(function (c) { return c.uid; });
              });
            }
          }
          var resT = tomarPozo(estado, plan);
          if (resT.ok) tomo = true;
        }
      }
    }
    if (!tomo) {
      var resR = robarDelMazo(estado);
      if (!resR.ok) return resR;
      if (resR.finDeMano) return resR;
    }
    if (estado.phase !== 'jugar') return { ok: true };
    cpuFusionar(estado, rng);
    if (estado.phase === 'fin') return { ok: true, salio: true };
    var descarte = cpuElegirDescarte(estado, rng);
    if (!descarte) return error('La CPU no encontró descarte.');
    return descartar(estado, descarte.uid);
  }

  // ---------------- Utilidades para pruebas ----------------
  function cartaDesdeCodigo(codigo, uid) {
    if (codigo === 'JOKER') return { uid: uid, rank: 'JOKER', suit: null };
    var rank = codigo.slice(0, codigo.length - 1);
    var suit = codigo.slice(-1);
    return { uid: uid, rank: rank, suit: suit };
  }
  // Construye una mano con cartas explícitas para escenarios de prueba.
  // spec: {manos:[[codigos],[codigos]], pozo:[codigos], mazo:[codigos],
  //        fusiones:{0:{A:[codigos]}}, tresRojos:{0:[codigos]},
  //        fusionado:[bool,bool], turno:0, congelado:bool, puntajesPrevios:[a,b]}
  // Las cartas no mencionadas quedan fuera (el invariante de 108 no aplica aquí).
  function crearManoPersonalizada(spec) {
    var uid = 1;
    function conv(lista) {
      return (lista || []).map(function (cod) { return cartaDesdeCodigo(cod, uid++); });
    }
    var estado = {
      players: [nuevoJugador(), nuevoJugador()],
      stock: conv(spec.mazo), pile: conv(spec.pozo),
      pileFrozen: !!spec.congelado,
      turn: spec.turno || 0, phase: spec.fase || 'robar',
      puntajesPrevios: spec.puntajesPrevios || [0, 0],
      log: [], resultado: null, rng: crearRng(1)
    };
    for (var j = 0; j < 2; j++) {
      estado.players[j].hand = conv(spec.manos && spec.manos[j]);
      estado.players[j].redThrees = conv(spec.tresRojos && spec.tresRojos[j]);
      estado.players[j].hasMelded = !!(spec.fusionado && spec.fusionado[j]);
      var fus = (spec.fusiones && spec.fusiones[j]) || {};
      Object.keys(fus).forEach(function (k) { estado.players[j].melds[k] = conv(fus[k]); });
    }
    return estado;
  }

  // ---------------- Exportación ----------------
  var Canasta = {
    PALOS: PALOS, SIMBOLO_PALO: SIMBOLO_PALO, VALORES: VALORES,
    PUNTOS_OBJETIVO: PUNTOS_OBJETIVO,
    esComodin: esComodin, esTresRojo: esTresRojo, esTresNegro: esTresNegro,
    esNatural: esNatural, valorCarta: valorCarta, puntosDeCartas: puntosDeCartas,
    codigoCarta: codigoCarta, crearMazo: crearMazo, crearRng: crearRng,
    crearPartida: crearPartida, minimoInicial: minimoInicial, nuevaMano: nuevaMano,
    puedeRobarPozo: puedeRobarPozo, pozoCongeladoPara: pozoCongeladoPara,
    cartaParaEmpatar: cartaParaEmpatar,
    robarDelMazo: robarDelMazo, tomarPozo: tomarPozo,
    fusionInicial: fusionInicial, fusionar: fusionar, descartar: descartar,
    puntuarMano: puntuarMano, cerrarMano: cerrarMano,
    contarCanastas: contarCanastas, tipoCanasta: tipoCanasta, bonusCanasta: bonusCanasta,
    cartasDeFusiones: cartasDeFusiones, validarInvariantes: validarInvariantes,
    agruparMano: agruparMano, buscarGruposIniciales: buscarGruposIniciales,
    cpuTurno: cpuTurno,
    _debug: { crearManoPersonalizada: crearManoPersonalizada }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Canasta;
  global.Canasta = Canasta;
})(typeof window !== 'undefined' ? window : globalThis);

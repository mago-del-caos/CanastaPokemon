/*
 * juego.js — Interfaz de Canasta Llena de Pokemones.
 * Solo pinta y llama al motor (canasta.js); ninguna regla vive aquí.
 * El partido en curso se guarda en localStorage para poder cerrar
 * la app y seguir la partida después.
 */
(function () {
  'use strict';

  var DATOS = null;
  var partida = null;
  var estado = null;
  var resumenMano = null;
  var finProcesado = false;
  var rng = Canasta.crearRng((Date.now() % 2147483646) + 1);

  var seleccion = new Set();       // uids seleccionados en la mano
  var gruposPendientes = [];       // grupos para fusión inicial / extras del pozo
  var modoPozo = null;             // { opcion } mientras se arma la toma del pozo
  var instalacionDiferida = null;

  var $ = function (id) { return document.getElementById(id); };
  var ORDEN_VALOR = { A: 0, K: 1, Q: 2, J: 3, '10': 4, '9': 5, '8': 6, '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12, JOKER: 13 };
  var NOMBRES = ['Jugador', 'CPU'];

  // ---------------- Pantallas ----------------
  function mostrar(id) {
    document.querySelectorAll('.pantalla').forEach(function (p) { p.classList.remove('activa'); });
    $(id).classList.add('activa');
    window.scrollTo(0, 0);
  }

  // ---------------- Cartas (vista) ----------------
  function datosCarta(carta) {
    var cod = Canasta.codigoCarta(carta);
    return DATOS[cod] || { pokemon: cod, img: '' };
  }
  function cartaHTML(carta, clase) {
    var d = datosCarta(carta);
    var roja = carta.suit === 'H' || carta.suit === 'D';
    var simbolo = carta.rank === 'JOKER' ? '★' : Canasta.SIMBOLO_PALO[carta.suit];
    var valorTxt = carta.rank === 'JOKER' ? 'COMODÍN' : carta.rank;
    return '<div class="carta ' + (clase || '') + (roja ? ' roja' : '') +
      (Canasta.esComodin(carta) ? ' comodin' : '') + '" data-uid="' + carta.uid + '">' +
      '<span class="esquina">' + valorTxt + '<br>' + simbolo + '</span>' +
      '<span class="valor">' + Canasta.valorCarta(carta) + '</span>' +
      (d.img ? '<img class="arte" src="' + d.img + '" alt="' + d.pokemon + '">' : '') +
      '<span class="nombre">' + d.pokemon + '</span></div>';
  }
  function dorsoHTML(clase) { return '<div class="carta dorso ' + (clase || '') + '"></div>'; }

  function fusionesHTML(jugador, tocable) {
    var claves = Object.keys(jugador.melds);
    if (!claves.length) return '<div class="sin-fusiones">Sin fusiones todavía.</div>';
    return claves.map(function (clave) {
      var cartas = jugador.melds[clave];
      var tipo = Canasta.tipoCanasta(clave, cartas);
      var nombre = clave === 'WILD' ? 'Comodines' : clave === '3N' ? 'Tres negros' : 'Valor ' + clave;
      var pie = nombre + ' · ' + cartas.length + ' cartas · ' + Canasta.puntosDeCartas(cartas) + ' pts';
      if (tipo) pie += ' · Canasta ' + tipo + ' (+' + Canasta.bonusCanasta(clave, cartas) + ')';
      return '<div class="fusion' + (tipo ? ' canasta' : '') + (tocable ? ' tocable' : '') +
        '" data-clave="' + clave + '"><div class="cartas">' +
        cartas.map(function (c) { return cartaHTML(c, 'mini'); }).join('') +
        '</div><div class="fusion-pie">' + pie + '</div></div>';
    }).join('');
  }

  // ---------------- Mensajes y registro ----------------
  function mensaje(texto, esError) {
    var m = $('mensaje');
    m.textContent = texto || '';
    m.className = 'mensaje' + (esError ? ' error' : '');
  }
  function registroHTML() {
    if (!estado) return '';
    return estado.log.slice(-3).map(function (e) {
      var quien = e.jugador >= 0 ? NOMBRES[e.jugador] + ' ' : '';
      return '<div>' + quien + e.texto + '</div>';
    }).join('');
  }

  // ---------------- Guardado ----------------
  function guardar() {
    if (!partida || !estado || estado.phase === 'fin') { return; }
    try {
      localStorage.setItem('canasta_partida_v1', JSON.stringify({ partida: partida, estado: estado }));
    } catch (e) { /* almacenamiento no disponible */ }
  }
  function borrarGuardado() {
    try { localStorage.removeItem('canasta_partida_v1'); } catch (e) {}
  }
  function hayGuardado() {
    try { return !!localStorage.getItem('canasta_partida_v1'); } catch (e) { return false; }
  }
  function historial() {
    try { return JSON.parse(localStorage.getItem('canasta_historial') || '{"ganadas":0,"perdidas":0}'); }
    catch (e) { return { ganadas: 0, perdidas: 0 }; }
  }

  // ---------------- Render principal ----------------
  function esMiTurno() { return estado && estado.turn === 0 && estado.phase !== 'fin'; }

  function render() {
    if (!estado) return;
    var yo = estado.players[0], cpu = estado.players[1];
    $('marcador-puntos').textContent = 'Tú ' + partida.puntajes[0] + ' · CPU ' + partida.puntajes[1];
    $('marcador-mano').textContent = 'Mano ' + partida.manoNumero +
      ' · Parcial de la mano: Tú ' + puntosManoParcial(0) + ' · CPU ' + puntosManoParcial(1);
    $('marcador-minimo').textContent = 'Fusión inicial: Tú ' +
      Canasta.minimoInicial(estado.puntajesPrevios[0]) + ' · CPU ' +
      Canasta.minimoInicial(estado.puntajesPrevios[1]);

    // Rival
    $('cpu-cartas').textContent = cpu.hand.length + (cpu.hand.length === 1 ? ' carta' : ' cartas');
    $('cpu-tres').textContent = cpu.redThrees.length ? '· 3 rojos apartados: ' + cpu.redThrees.length : '';
    $('cpu-dorsos').innerHTML = cpu.hand.slice(0, 16).map(function () { return dorsoHTML('mini'); }).join('');
    $('cpu-fusiones').innerHTML = fusionesHTML(cpu, false);

    // Centro
    $('mazo-vista').innerHTML = estado.stock.length ? dorsoHTML('') :
      '<div class="carta vacia">Mazo agotado</div>';
    $('mazo-num').textContent = estado.stock.length;
    $('pozo-num').textContent = estado.pile.length;
    var infoPozo = Canasta.puedeRobarPozo(estado, 0);
    var estadoPozo = '';
    if (estado.pile.length) {
      var arriba = estado.pile[estado.pile.length - 1];
      $('pozo-vista').innerHTML = cartaHTML(arriba, Canasta.esComodin(arriba) ? 'cruzada' : '');
      if (Canasta.esTresNegro(arriba)) estadoPozo = '· bloqueado por un 3 negro';
      else if (infoPozo.congelado && estado.turn === 0) estadoPozo = '· congelado para ti';
      else if (estado.pileFrozen) estadoPozo = '· congelado';
      if (Canasta.esComodin(arriba)) {
        var obj = Canasta.cartaParaEmpatar(estado);
        if (obj) estadoPozo += ' · a empatar: ' + obj.carta.rank + Canasta.SIMBOLO_PALO[obj.carta.suit];
      }
    } else {
      $('pozo-vista').innerHTML = '<div class="carta vacia">Pozo vacío</div>';
    }
    $('pozo-estado').textContent = estadoPozo;
    $('registro').innerHTML = registroHTML();

    // Propio
    $('tu-tres').textContent = yo.redThrees.length ?
      '· 3 rojos apartados: ' + yo.redThrees.length + ' (' + (yo.hasMelded ? '+' : '−') + (yo.redThrees.length * 100) + ')' : '';
    $('mis-fusiones').innerHTML = fusionesHTML(yo, esMiTurno() && estado.phase === 'jugar');
    renderPendientes();

    // Mano ordenada por valor
    var manoOrdenada = yo.hand.slice().sort(function (a, b) {
      return (ORDEN_VALOR[a.rank] - ORDEN_VALOR[b.rank]) ||
        String(a.suit).localeCompare(String(b.suit));
    });
    $('mano-num').textContent = yo.hand.length;
    $('mano').innerHTML = manoOrdenada.map(function (c) {
      return cartaHTML(c, seleccion.has(c.uid) ? 'seleccionada' : '');
    }).join('');

    renderAcciones();
  }

  // Puntos "en vivo" de la mano en curso (sin cerrar): fusiones + canastas + tres rojos.
  function puntosManoParcial(idx) {
    var j = estado.players[idx], s = 0;
    Object.keys(j.melds).forEach(function (k) {
      s += Canasta.puntosDeCartas(j.melds[k]) + Canasta.bonusCanasta(k, j.melds[k]);
    });
    s += j.redThrees.length * (j.hasMelded ? 100 : -100);
    return s;
  }

  function puntosGruposPendientes() {
    var yo = estado.players[0], total = 0;
    gruposPendientes.forEach(function (g) {
      g.forEach(function (uid) {
        var c = yo.hand.find(function (x) { return x.uid === uid; });
        if (c) total += Canasta.valorCarta(c);
      });
    });
    return total;
  }
  function puntosComboPozo() {
    if (!modoPozo) return 0;
    var yo = estado.players[0], total = 0;
    modoPozo.opcion.ids.forEach(function (uid) {
      var c = yo.hand.find(function (x) { return x.uid === uid; });
      if (c) total += Canasta.valorCarta(c);
    });
    var obj = Canasta.cartaParaEmpatar(estado);
    if (obj) total += Canasta.valorCarta(obj.carta);
    return total;
  }

  function renderPendientes() {
    var zona = $('zona-pendiente');
    var yo = estado.players[0];
    if (!gruposPendientes.length && !modoPozo) { zona.className = 'zona-pendiente oculto'; zona.innerHTML = ''; return; }
    var minimo = Canasta.minimoInicial(estado.puntajesPrevios[0]);
    var html = '';
    if (modoPozo) {
      var comboTxt = { pareja: 'pareja natural', naturalComodin: 'natural + comodín', fusion: 'tu fusión en mesa' }[modoPozo.opcion.tipo];
      html += '<strong>Toma del pozo</strong> con ' + comboTxt + ': ' + puntosComboPozo() + ' puntos.';
      if (!yo.hasMelded) html += ' Puedes añadir grupos extra para llegar al mínimo de ' + minimo + '.';
    } else {
      html += '<strong>Fusión inicial:</strong> ' + puntosGruposPendientes() + ' de ' + minimo + ' puntos.';
    }
    if (gruposPendientes.length) {
      html += '<br>Grupos listos: ' + gruposPendientes.map(function (g, i) {
        return 'grupo ' + (i + 1) + ' (' + g.length + ' cartas)';
      }).join(', ') + '.';
    }
    zona.className = 'zona-pendiente';
    zona.innerHTML = html;
  }

  // ---------------- Barra de acciones ----------------
  function boton(texto, id, clase) {
    return '<button class="btn ' + (clase || '') + '" data-accion="' + id + '">' + texto + '</button>';
  }
  function renderAcciones() {
    var barra = $('barra-acciones');
    if (!estado || estado.phase === 'fin') { barra.innerHTML = ''; return; }
    if (estado.turn === 1) {
      barra.innerHTML = '<div class="sin-fusiones">Turno de la CPU…</div>';
      return;
    }
    var yo = estado.players[0];
    var html = '';
    if (estado.phase === 'robar') {
      if (modoPozo) {
        html += boton('Añadir grupo extra (selección)', 'anadir-grupo');
        html += boton('Quitar último grupo', 'quitar-grupo');
        html += boton('Confirmar: tomar el pozo', 'confirmar-pozo', 'principal');
        html += boton('Cancelar la toma', 'cancelar-pozo', 'peligro');
      } else {
        html += boton(estado.stock.length ? 'Robar 2 del mazo' : 'No robar (termina la mano)', 'robar', 'principal');
        html += boton('Tomar el pozo (' + estado.pile.length + ' cartas)', 'tomar-pozo');
      }
    } else if (estado.phase === 'jugar') {
      if (modoPozo) {
        html += boton('Añadir grupo extra (selección)', 'anadir-grupo');
        html += boton('Quitar último grupo', 'quitar-grupo');
        html += boton('Confirmar: tomar el pozo', 'confirmar-pozo', 'principal');
        html += boton('Cancelar la toma', 'cancelar-pozo', 'peligro');
      } else if (!yo.hasMelded) {
        html += boton('Añadir grupo a la fusión inicial', 'anadir-grupo');
        html += boton('Quitar último grupo', 'quitar-grupo');
        html += boton('Confirmar fusión inicial', 'confirmar-inicial', 'principal');
        html += boton('Descartar 1 carta', 'descartar');
      } else {
        html += boton('Fusionar selección', 'fusionar', 'principal');
        html += boton('Descartar 1 carta', 'descartar');
        html += boton('Limpiar selección', 'limpiar');
      }
    }
    barra.innerHTML = html;
  }

  // ---------------- Acciones del jugador ----------------
  function trasAccion() {
    seleccion.clear();
    guardar();
    render();
    if (estado.phase === 'fin') { procesarFinDeMano(); return; }
    if (estado.turn === 1) {
      mensaje('Turno de la CPU…');
      setTimeout(turnoCpu, 900);
    } else if (estado.phase === 'robar') {
      mensaje('Tu turno: roba 2 cartas o toma el pozo.');
    }
  }

  function turnoCpu() {
    if (!estado || estado.phase === 'fin' || estado.turn !== 1) return;
    var r = Canasta.cpuTurno(estado, rng);
    if (!r.ok) { mensaje('La CPU no pudo jugar: ' + r.error, true); return; }
    guardar();
    render();
    if (estado.phase === 'fin') { procesarFinDeMano(); return; }
    mensaje('Tu turno: roba 2 cartas o toma el pozo.');
  }

  function accion(nombre) {
    if (!esMiTurno()) return;
    var yo = estado.players[0];
    var r;
    switch (nombre) {
      case 'robar':
        r = Canasta.robarDelMazo(estado);
        if (!r.ok) { mensaje(r.error, true); return; }
        if (r.finDeMano) { render(); procesarFinDeMano(); return; }
        mensaje(r.tresRojos ? 'Robaste y apartaste un 3 rojo (con repuesto). Ahora fusiona o descarta.' :
          'Robaste 2 cartas. Fusiona si quieres y descarta 1 para cerrar tu turno.');
        trasAccionSinCpu();
        return;
      case 'tomar-pozo': {
        var info = Canasta.puedeRobarPozo(estado, 0);
        if (!info.puede) { mensaje(info.motivo, true); return; }
        if (info.opciones.length === 1 && yo.hasMelded) {
          r = Canasta.tomarPozo(estado, { tipo: info.opciones[0].tipo });
          if (!r.ok) { mensaje(r.error, true); return; }
          mensaje('Tomaste el pozo con ' + r.cartasGanadas + ' cartas. Fusiona o descarta.');
          trasAccionSinCpu();
          return;
        }
        elegirOpcionPozo(info);
        return;
      }
      case 'confirmar-pozo': {
        if (!modoPozo) return;
        r = Canasta.tomarPozo(estado, { tipo: modoPozo.opcion.tipo, gruposExtra: gruposPendientes });
        if (!r.ok) { mensaje(r.error, true); return; }
        modoPozo = null; gruposPendientes = [];
        mensaje('Tomaste el pozo con ' + r.cartasGanadas + ' cartas. Sigue fusionando o descarta.');
        trasAccionSinCpu();
        return;
      }
      case 'cancelar-pozo':
        modoPozo = null; gruposPendientes = []; seleccion.clear();
        mensaje('Toma cancelada. Roba del mazo o inténtalo de otra forma.');
        render();
        return;
      case 'anadir-grupo': {
        if (!seleccion.size) { mensaje('Primero toca las cartas del grupo en tu mano.', true); return; }
        gruposPendientes.push(Array.from(seleccion));
        seleccion.clear();
        render();
        return;
      }
      case 'quitar-grupo':
        gruposPendientes.pop();
        render();
        return;
      case 'confirmar-inicial': {
        var grupos = gruposPendientes.slice();
        if (seleccion.size) grupos.push(Array.from(seleccion));
        if (!grupos.length) { mensaje('Añade al menos un grupo con «Añadir grupo».', true); return; }
        r = Canasta.fusionInicial(estado, grupos);
        if (!r.ok) { mensaje(r.error, true); return; }
        gruposPendientes = [];
        mensaje('Fusión inicial hecha con ' + r.puntos + ' puntos.');
        trasAccionSinCpu();
        return;
      }
      case 'fusionar': {
        if (!seleccion.size) { mensaje('Primero toca las cartas que quieres fusionar.', true); return; }
        r = Canasta.fusionar(estado, Array.from(seleccion));
        if (!r.ok) { mensaje(r.error, true); return; }
        mensaje('Fusión hecha.');
        trasAccionSinCpu();
        return;
      }
      case 'descartar': {
        if (seleccion.size !== 1) { mensaje('Para descartar, selecciona exactamente 1 carta.', true); return; }
        r = Canasta.descartar(estado, Array.from(seleccion)[0]);
        if (!r.ok) { mensaje(r.error, true); return; }
        if (r.salio) { render(); procesarFinDeMano(); return; }
        trasAccion();
        return;
      }
      case 'limpiar':
        seleccion.clear();
        render();
        return;
    }
  }

  // Como trasAccion, pero sin disparar a la CPU (sigue siendo mi turno).
  function trasAccionSinCpu() {
    seleccion.clear();
    guardar();
    render();
    if (estado.phase === 'fin') procesarFinDeMano();
  }

  function elegirOpcionPozo(info) {
    var barra = $('barra-acciones');
    var textos = { pareja: 'Con pareja natural', naturalComodin: 'Con natural + comodín', fusion: 'Con mi fusión en mesa' };
    barra.innerHTML = info.opciones.map(function (o) {
      return '<button class="btn principal" data-opcion-pozo="' + o.tipo + '">' + textos[o.tipo] + '</button>';
    }).join('') + boton('Cancelar', 'cancelar-opciones');
    mensaje('¿Cómo tomas el pozo?');
    barra.querySelectorAll('[data-opcion-pozo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tipo = b.getAttribute('data-opcion-pozo');
        var op = info.opciones.find(function (o) { return o.tipo === tipo; });
        if (estado.players[0].hasMelded) {
          var r = Canasta.tomarPozo(estado, { tipo: tipo });
          if (!r.ok) { mensaje(r.error, true); render(); return; }
          mensaje('Tomaste el pozo con ' + r.cartasGanadas + ' cartas. Fusiona o descarta.');
          trasAccionSinCpu();
        } else {
          modoPozo = { opcion: op };
          mensaje('Puedes añadir grupos extra para alcanzar el mínimo inicial y luego confirmar.');
          render();
        }
      });
    });
    var canc = barra.querySelector('[data-accion="cancelar-opciones"]');
    if (canc) canc.addEventListener('click', function () { render(); });
  }

  // ---------------- Fin de mano / partido ----------------
  function procesarFinDeMano() {
    if (finProcesado || !estado.resultado) return;
    finProcesado = true;
    resumenMano = Canasta.cerrarMano(partida, estado);
    borrarGuardado();
    var d = estado.resultado;
    var detalle;
    if (d.salio === 0) detalle = d.oculta ? 'Saliste de forma oculta. ¡Bien jugado!' : 'Saliste tú.';
    else if (d.salio === 1) detalle = d.oculta ? 'La CPU salió de forma oculta.' : 'La CPU salió.';
    else detalle = 'El mazo se agotó y nadie tomó el pozo.';
    $('fin-mano-detalle').textContent = detalle;
    $('fin-mano-titulo').textContent = 'Fin de la mano ' + resumenMano.manoNumero;
    var filas = [
      ['Fusiones en mesa', 'fusiones'], ['Canastas', 'canastas'], ['Tres rojos', 'tresRojos'],
      ['Bonus de salida', 'salida'], ['Cartas en mano', 'enMano']
    ];
    var html = '<table class="desglose"><thead><tr><th>Concepto</th><th>Tú</th><th>CPU</th></tr></thead><tbody>';
    filas.forEach(function (f) {
      html += '<tr><td>' + f[0] + '</td><td>' + d.desglose[0][f[1]] + '</td><td>' + d.desglose[1][f[1]] + '</td></tr>';
    });
    html += '<tr class="total"><td>Total de la mano</td><td>' + d.desglose[0].total + '</td><td>' + d.desglose[1].total + '</td></tr>';
    html += '<tr class="acumulado"><td>Acumulado del partido</td><td>' + partida.puntajes[0] + '</td><td>' + partida.puntajes[1] + '</td></tr>';
    html += '</tbody></table>';
    $('fin-mano-tabla').innerHTML = html;
    $('btn-siguiente-mano').textContent = resumenMano.terminada ? 'Ver el resultado del partido' : 'Siguiente mano';
    mostrar('pantalla-fin-mano');
  }

  function mostrarFinPartido() {
    var gano = partida.ganador === 0;
    var h = historial();
    if (gano) h.ganadas++; else h.perdidas++;
    try { localStorage.setItem('canasta_historial', JSON.stringify(h)); } catch (e) {}
    $('fin-partido-titulo').textContent = gano ? 'Ganaste el partido' : 'La CPU ganó el partido';
    $('fin-partido-detalle').textContent = 'Marcador final: Tú ' + partida.puntajes[0] +
      ' · CPU ' + partida.puntajes[1] + ', en ' + partida.manoNumero + ' mano(s). ' +
      'Historial: ' + h.ganadas + ' ganadas, ' + h.perdidas + ' perdidas.';
    mostrar('pantalla-fin-partido');
  }

  function nuevaMano() {
    estado = Canasta.nuevaMano(partida, rng);
    seleccion.clear(); gruposPendientes = []; modoPozo = null;
    finProcesado = false; resumenMano = null;
    guardar();
    mostrar('pantalla-juego');
    render();
    if (estado.turn === 1) { mensaje('La CPU empieza esta mano…'); setTimeout(turnoCpu, 900); }
    else mensaje('Tu turno: roba 2 cartas o toma el pozo.');
  }

  function nuevaPartida() {
    partida = Canasta.crearPartida();
    nuevaMano();
  }

  // ---------------- Eventos ----------------
  $('mano').addEventListener('click', function (ev) {
    var el = ev.target.closest('.carta');
    if (!el || !esMiTurno()) return;
    var uid = Number(el.getAttribute('data-uid'));
    if (seleccion.has(uid)) seleccion.delete(uid); else seleccion.add(uid);
    render();
  });
  $('mis-fusiones').addEventListener('click', function (ev) {
    var el = ev.target.closest('.fusion');
    if (!el || !seleccion.size || !esMiTurno() || estado.phase !== 'jugar') return;
    if (!estado.players[0].hasMelded || modoPozo) return;
    var r = Canasta.fusionar(estado, Array.from(seleccion), el.getAttribute('data-clave'));
    if (!r.ok) { mensaje(r.error, true); return; }
    mensaje('Cartas añadidas a la fusión.');
    trasAccionSinCpu();
  });
  $('barra-acciones').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (b) accion(b.getAttribute('data-accion'));
  });
  $('btn-jugar').addEventListener('click', function () {
    if (hayGuardado() && !confirm('Hay una partida guardada. ¿Empezar una nueva y perder la guardada?')) return;
    borrarGuardado();
    nuevaPartida();
  });
  $('btn-continuar').addEventListener('click', function () {
    try {
      var datos = JSON.parse(localStorage.getItem('canasta_partida_v1'));
      partida = datos.partida; estado = datos.estado;
      estado.rng = rng;
      seleccion.clear(); gruposPendientes = []; modoPozo = null; finProcesado = false;
      mostrar('pantalla-juego');
      render();
      if (estado.turn === 1) { mensaje('Turno de la CPU…'); setTimeout(turnoCpu, 700); }
      else mensaje(estado.phase === 'robar' ? 'Tu turno: roba 2 cartas o toma el pozo.' : 'Sigue tu turno: fusiona o descarta.');
    } catch (e) { mensaje('No se pudo cargar la partida guardada.', true); }
  });
  $('btn-reglas').addEventListener('click', function () { mostrar('pantalla-reglas'); });
  $('btn-volver-inicio').addEventListener('click', function () { mostrar('pantalla-inicio'); refrescarInicio(); });
  $('btn-abandonar').addEventListener('click', function () {
    if (!confirm('¿Abandonar la partida? Se borrará la partida guardada.')) return;
    borrarGuardado();
    partida = null; estado = null;
    mostrar('pantalla-inicio'); refrescarInicio();
  });
  $('btn-siguiente-mano').addEventListener('click', function () {
    if (resumenMano && resumenMano.terminada) { mostrarFinPartido(); return; }
    nuevaMano();
  });
  $('btn-otra-partida').addEventListener('click', nuevaPartida);
  $('btn-ir-inicio').addEventListener('click', function () { mostrar('pantalla-inicio'); refrescarInicio(); });

  function refrescarInicio() {
    $('btn-continuar').classList.toggle('oculto', !hayGuardado());
    var h = historial();
    $('historial').textContent = (h.ganadas + h.perdidas) ?
      'Tu historial: ' + h.ganadas + ' partidas ganadas, ' + h.perdidas + ' perdidas.' : '';
    var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var instalada = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    $('btn-instalar').classList.toggle('oculto', !instalacionDiferida || instalada);
    $('ios-instalar').classList.toggle('oculto', !(esIOS && !instalada));
  }

  // ---------------- Instalación y SW ----------------
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    instalacionDiferida = e;
    refrescarInicio();
  });
  $('btn-instalar').addEventListener('click', function () {
    if (!instalacionDiferida) return;
    instalacionDiferida.prompt();
    instalacionDiferida.userChoice.then(function () { instalacionDiferida = null; refrescarInicio(); });
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin SW la app sigue en línea */ });
    });
  }

  // ---------------- Arranque ----------------
  fetch('datos-cartas.json')
    .then(function (r) { return r.json(); })
    .then(function (json) { DATOS = json; refrescarInicio(); })
    .catch(function () {
      DATOS = {};
      document.querySelector('#pantalla-inicio .subtitulo').textContent =
        'No se pudieron cargar los datos de las cartas. Revisa tu conexión la primera vez que abras la app.';
    });
})();

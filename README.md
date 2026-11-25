# Canasta Llena de Pokemones

El juego de cartas **Canasta clásico** (el rummy de fusiones de toda la vida, con dos barajas y comodines) en versión app web para celular: **tú contra la CPU**, en partidos a **5000 puntos**. Cada carta de la baraja lleva un Pokémon de las generaciones 1 y 2, con su arte oficial obtenido de PokéAPI. El comodín es **Ditto**, el Pokémon que se transforma en cualquiera.

Es una PWA instalable y **100 % jugable sin conexión** tras la primera carga: el service worker precarga todo (código, datos y las 53 ilustraciones de cartas) y la partida en curso se guarda en el teléfono.

## Cómo jugar (resumen)

- **Turno:** roba 2 cartas del mazo o toma todo el pozo; fusiona lo que quieras; descarta 1 carta.
- **Fusiones:** grupos de 3 a 7 cartas del mismo valor. Los comodines (Ditto y todos los 2) ayudan, pero nunca pueden superar en número a las cartas naturales. Fusión de 7 = **canasta**: natural 500, mixta 300, de puros comodines 2000.
- **Valores:** comodín 50; As y 2 = 20; K, Q, J, 10, 9, 8 = 10; 7, 6, 5, 4 y 3 negro = 5. El **3 rojo** es bonus: se aparta al recibirlo (con repuesto) y vale **+100** si fusionaste en la mano, **−100** si no fusionaste nada.
- **Fusión inicial:** la primera fusión de cada mano debe sumar un mínimo según tu puntaje del partido: negativo → 15; 0–1495 → 50; 1500–2995 → 90; 3000+ → 120.
- **El pozo:** se toma empatando su carta superior con pareja natural; si no está congelado para ti, también con natural + comodín o si la carta encaja en una fusión tuya en mesa. Está congelado mientras no hayas hecho tu fusión inicial, y se congela para todos cuando alguien descarta un comodín (congelado: solo pareja natural). Un **3 negro** arriba bloquea el pozo un turno; los 3 negros solo se fusionan (3 o 4, sin comodines) en el turno en que sales.
- **Salir:** necesitas al menos una canasta. Bonus de salida: 100; salida oculta (sin haber fusionado antes en la mano): 200. Al salir, el rival resta el valor de las cartas que le queden en mano. Si el mazo se agota y quien debe robar no toma el pozo, la mano termina y se puntúa sin bonus de salida.

La propia app incluye la pantalla «Cómo jugar» con estas reglas.

## Funciones de app (v2)

- **Dificultad de la CPU en 3 niveles** (Fácil / Normal / Difícil), elegible en la pantalla de inicio y persistente. No cambian las reglas, solo las decisiones: en Fácil la CPU nunca toma el pozo, fusiona de forma simple y descarta con mucho ruido (puede romper parejas o soltar un comodín); en Difícil toma el pozo antes, fusiona completo y descarta siempre su mejor carta según la heurística del motor, sin ruido.
- **Botón «Pista»**: sugiere una jugada legal razonable (tomar el pozo si compensa, la fusión inicial, añadir a una fusión, cerrar una canasta o el descarte menos útil) y resalta las cartas implicadas, sin jugar por ti.
- **Botón «Deshacer fusiones de este turno»**: retira las fusiones hechas en el turno en curso y deja la mano como estaba justo después de robar (solo antes de descartar).
- **Animaciones de cartas** (FLIP, sin librerías): las cartas viajan del mazo a la mano, de la mano a las fusiones y al pozo; las canastas recién cerradas pulsan una vez. Se desactivan si el sistema pide movimiento reducido.
- **Efectos de sonido con WebAudio** (sin archivos): robar, tomar el pozo, fusionar, canasta, descartar, victoria y derrota. Botón «Sonido: sí/no» en la cabecera de la partida y ajuste persistente.
- **Estadísticas persistentes**: partidos ganados/perdidos, mejor puntaje y racha actual, visibles en el inicio y al final de cada partido (migra el historial antiguo). La pantalla de fin de mano incluye la **tabla de puntajes mano a mano** del partido en curso.
- **Ordenar la mano con un toque**: por valor o por palo (botones en la zona de la mano, persistente).
- **Indicadores**: las canastas cerradas llevan la carta cruzada del juego físico — roja si es natural, negra si es mixta, morada si es de comodines — y se distinguen también por el fondo; contadores de mazo y pozo siempre visibles; aviso verde «Ya tienes una canasta: puedes salir» en cuanto completas una.
- **Panel de ajustes**: sonido sí/no y velocidad de la CPU (lenta / normal / rápida), persistentes en el teléfono.

## Las cartas Pokémon

El mapeo palo/valor → Pokémon está en `datos-cartas.json` y las ilustraciones en `assets/cartas/`. Algunos destacados: As de corazones = **Pikachu**, As de picas = **Mewtwo**, As de diamantes = **Charizard**, As de tréboles = **Mew**; Reinas: **Espeon** y **Umbreon**; Jotas: **Eevee**, **Jigglypuff**, **Togepi** y **Psyduck**; los 10 son los iniciales (Bulbasaur, Charmander, Squirtle, Chikorita); el 3 de corazones (3 rojo) es **Zubat** y el de diamantes **Slowpoke**; comodín = **Ditto**.

## Correr en local

```bash
cd canasta-pokemon
python3 -m http.server 8000
# abre http://localhost:8000 en el navegador
```

(Servir por HTTP es necesario para que el service worker y el modo offline funcionen; abrir el `index.html` como archivo no activa la PWA.)

## Estructura

| Archivo | Qué es |
|---|---|
| `canasta.js` | Motor de reglas puro (sin DOM, UMD): estado, acciones legales, puntuación y la CPU heurística. |
| `juego.js` | Interfaz: pinta el tablero y llama al motor; guarda la partida en `localStorage`. |
| `index.html` / `estilo.css` | Pantallas (inicio, reglas, juego, fin de mano, fin de partido) y el diseño. |
| `datos-cartas.json` | Mapeo carta → Pokémon (nombre en español e ilustración). |
| `assets/` | Banner de inicio, iconos PWA y las 53 ilustraciones de cartas. |
| `sw.js` / `manifest.webmanifest` | Service worker (precache `canasta-v2`, cache-first) y manifiesto de la PWA. |
| `tools/generar_cartas.py` | Regenera `datos-cartas.json` y las ilustraciones desde PokéAPI (solo al construir). |
| `tests/motor.test.js` | Suite del motor: escenarios calculados a mano, niveles de dificultad, sugerencias de pista y partidas completas CPU vs CPU y aleatorias con invariantes. `node tests/motor.test.js` |
| `tests/ui.test.js` | Auditoría con Chromium headless: cero errores de consola, anchos, pantallas (inicio, reglas, ajustes, partida, fin de mano), turnos reales contra la CPU en los 3 niveles, pista, deshacer, orden, precache y modo offline. `node tests/ui.test.js` |

## Créditos

- Datos y arte: [PokéAPI](https://pokeapi.co) y el repositorio PokeAPI/sprites.
- Proyecto de fans **sin fines de lucro**. Pokémon, los nombres de los personajes y las ilustraciones son marcas y propiedad de Nintendo, Creatures Inc. y Game Freak Inc. Este proyecto no está afiliado ni respaldado por ellos.

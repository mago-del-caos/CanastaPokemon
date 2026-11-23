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
| `sw.js` / `manifest.webmanifest` | Service worker (precache `canasta-v1`, cache-first) y manifiesto de la PWA. |
| `tools/generar_cartas.py` | Regenera `datos-cartas.json` y las ilustraciones desde PokéAPI (solo al construir). |
| `tests/motor.test.js` | Suite del motor: escenarios calculados a mano y partidas completas CPU vs CPU y aleatorias con invariantes. `node tests/motor.test.js` |
| `tests/ui.test.js` | Prueba con Chromium headless: errores de consola, anchos, turnos reales contra la CPU, precache y modo offline. `node tests/ui.test.js` |

## Créditos

- Datos y arte: [PokéAPI](https://pokeapi.co) y el repositorio PokeAPI/sprites.
- Proyecto de fans **sin fines de lucro**. Pokémon, los nombres de los personajes y las ilustraciones son marcas y propiedad de Nintendo, Creatures Inc. y Game Freak Inc. Este proyecto no está afiliado ni respaldado por ellos.

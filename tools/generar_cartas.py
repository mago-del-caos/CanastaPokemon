#!/usr/bin/env python3
"""
Genera datos-cartas.json y descarga el arte de cada carta Pokémon.

- Elige 52 Pokémon de las generaciones 1 y 2 (1-251), uno por cada
  combinación palo/valor de la baraja, incluyendo los Pokémon del banner
  de Pablo (Pikachu, Jigglypuff, Espeon, Togepi, Umbreon, Charmander,
  Bulbasaur, Squirtle, Eevee y Psyduck).
- El comodín es Ditto (132): el Pokémon que se transforma en cualquiera.
- Nombre en español desde https://pokeapi.co/api/v2/pokemon-species/{id}
- Arte official-artwork de PokeAPI/sprites, redimensionado con PIL a
  340 px de ancho, guardado en assets/cartas/{CLAVE}.png
  (CLAVE = valor+palo, p. ej. AS, 10H, KD; comodín = JOKER).

Uso:  python3 tools/generar_cartas.py
Solo se ejecuta al construir el proyecto; el juego NO llama a la red.
"""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
DIR_CARTAS = RAIZ / "assets" / "cartas"
SALIDA = RAIZ / "datos-cartas.json"
ANCHO_ARTE = 340

# valor -> [ (palo, id pokedex) x4 ]  palos en orden S(♠) H(♥) D(♦) C(♣)
MAPA = {
    "A":  [("S", 150), ("H", 25),  ("D", 6),   ("C", 151)],   # Mewtwo, Pikachu, Charizard, Mew
    "K":  [("S", 149), ("H", 59),  ("D", 130), ("C", 143)],   # Dragonite, Arcanine, Gyarados, Snorlax
    "Q":  [("S", 196), ("H", 38),  ("D", 131), ("C", 197)],   # Espeon, Ninetales, Lapras, Umbreon
    "J":  [("S", 133), ("H", 39),  ("D", 175), ("C", 54)],    # Eevee, Jigglypuff, Togepi, Psyduck
    "10": [("S", 1),   ("H", 4),   ("D", 7),   ("C", 152)],   # Bulbasaur, Charmander, Squirtle, Chikorita
    "9":  [("S", 2),   ("H", 5),   ("D", 8),   ("C", 155)],   # Ivysaur, Charmeleon, Wartortle, Cyndaquil
    "8":  [("S", 3),   ("H", 9),   ("D", 158), ("C", 18)],    # Venusaur, Blastoise, Totodile, Pidgeot
    "7":  [("S", 26),  ("H", 37),  ("D", 36),  ("C", 40)],    # Raichu, Vulpix, Clefable, Wigglytuff
    "6":  [("S", 52),  ("H", 58),  ("D", 55),  ("C", 65)],    # Meowth, Growlithe, Golduck, Alakazam
    "5":  [("S", 92),  ("H", 93),  ("D", 94),  ("C", 200)],   # Gastly, Haunter, Gengar, Misdreavus
    "4":  [("S", 10),  ("H", 16),  ("D", 13),  ("C", 19)],    # Caterpie, Pidgey, Weedle, Rattata
    "3":  [("S", 129), ("H", 41),  ("D", 79),  ("C", 74)],    # Magikarp, Zubat, Slowpoke, Geodude
    "2":  [("S", 63),  ("H", 95),  ("D", 76),  ("C", 68)],    # Abra, Onix, Golem, Machamp
}
ID_DITTO = 132

URL_ESPECIE = "https://pokeapi.co/api/v2/pokemon-species/{id}"
URL_ARTE = ("https://raw.githubusercontent.com/PokeAPI/sprites/master/"
            "sprites/pokemon/other/official-artwork/{id}.png")


def descargar(url, binario=False, intentos=3):
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CanastaPokemon/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                datos = r.read()
            return datos if binario else json.loads(datos.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == intentos - 1:
                raise
            print(f"  reintento {i + 1} para {url}: {e}", file=sys.stderr)
            time.sleep(1.5 * (i + 1))


def nombre_es(id_pokedex, datos_especie):
    for n in datos_especie.get("names", []):
        if n.get("language", {}).get("name") == "es":
            return n["name"]
    return datos_especie["name"].capitalize()


def procesar(clave, id_pokedex):
    especie = descargar(URL_ESPECIE.format(id=id_pokedex))
    nombre = nombre_es(id_pokedex, especie)
    crudo = descargar(URL_ARTE.format(id=id_pokedex), binario=True)
    img = Image.open(io.BytesIO(crudo)).convert("RGBA")
    if img.width != ANCHO_ARTE:
        alto = round(img.height * ANCHO_ARTE / img.width)
        img = img.resize((ANCHO_ARTE, alto), Image.LANCZOS)
    destino = DIR_CARTAS / f"{clave}.png"
    img.save(destino, optimize=True)
    return {"pokemon": nombre, "idPokedex": id_pokedex,
            "img": f"assets/cartas/{clave}.png"}


def main():
    DIR_CARTAS.mkdir(parents=True, exist_ok=True)
    salida = {}
    total = 0
    for valor, cartas in MAPA.items():
        for palo, id_pokedex in cartas:
            clave = f"{valor}{palo}"
            salida[clave] = procesar(clave, id_pokedex)
            total += 1
            print(f"{clave}: {salida[clave]['pokemon']} (#{id_pokedex})")
    salida["JOKER"] = procesar("JOKER", ID_DITTO)
    print(f"JOKER: {salida['JOKER']['pokemon']} (#{ID_DITTO}) — el comodín")
    total += 1
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    print(f"\n{total} cartas escritas en {SALIDA}")


if __name__ == "__main__":
    main()

# Berlijn POI Planner (static)

Een simpele, **GitHub Pages-vriendelijke** webapp (geen build tools) om Points of Interest (POI’s) in Berlijn te beheren,
gegroepeerd op thema (Koude Oorlog, WO2, Modern Berlijn, Cocktails, Restaurants).

## Features
- Thema-filter + zoekveld
- Kaart (Leaflet)
- Favorieten (localStorage)
- **Routekaart binnen Berlijn**: voeg POI’s toe aan de route of maak `Route = Favorieten`  
  (route wordt getekend via OSRM / Leaflet Routing Machine)
- Detailpaneel met:
  - **Klikbaar plaatje** → opent **bronpagina** van het plaatje (Wikimedia Commons “File:” pagina)
  - **Meer info** link: NL als beschikbaar, anders EN

## Live draaien (lokaal)
Vanuit deze map:

### Optie A: Python (makkelijk)
```bash
python -m http.server 8000
```
Open daarna in je browser: `http://localhost:8000`

### Optie B: VSCode Live Server
Open folder → “Go Live”.

> Let op: `fetch("./pois.json")` werkt niet als je `index.html` direct via `file://` opent.

## Deploy naar GitHub Pages
1. Maak een repo aan en commit de bestanden.
2. GitHub → Settings → Pages → Deploy from branch → `/ (root)` → Save.
3. Wacht tot Pages live is.

## POI’s aanpassen / uitbreiden
Alle data staat in `pois.json`.

Velden per POI:
- `title`, `theme`, `lat`, `lng`
- `info.nl` en/of `info.en` (als NL niet bestaat, laat je die weg)
- `image.commonsFile` (bestandsnaam op Wikimedia Commons)
- `image.sourcePage` (optioneel; anders wordt automatisch `https://commons.wikimedia.org/wiki/File:<commonsFile>` gebruikt)

### Afbeelding toevoegen (Wikimedia Commons)
1. Zoek een geschikte foto op Wikimedia Commons.
2. Neem de **File name** over (bijv. `Holocaust-Mahnmal Berlin.jpg`).
3. Plak in `image.commonsFile`.
4. Klaar: het plaatje wordt getoond en is klikbaar naar de bron.

## Disclaimer
Coördinaten en sommige links zijn een **starter set** (handig als basis). Controleer/verbeter ze gerust op basis van jouw bronnen
(Wikipedia, berlin.de, officiële sites).


## Import scripts (Wikipedia/Wikidata)

Zie `scripts/README.md`.

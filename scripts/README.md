# Import scripts

Deze map bevat scripts om automatisch **coördinaten (P625)** en **Commons-afbeeldingen (P18)** uit Wikidata/Wikipedia te halen.

## 1) Bestaande POI's aanvullen vanuit Wikipedia → Wikidata
Dit is de handigste: je huidige `pois.json` heeft vaak al `info.nl` of `info.en` als Wikipedia-link.
Het script vindt dan automatisch het bijbehorende Wikidata-item en vult aan.

### Run (Node 18+)
```bash
node scripts/fill-pois-from-wikipedia.mjs
```

### Opties
- `--overwrite`  : overschrijf bestaande lat/lng of afbeelding
- `--dry-run`    : niets schrijven, alleen loggen
- `--in <pad>`   : input JSON (default `pois.json`)
- `--out <pad>`  : output JSON (default overschrijft input)
- `--ua "<UA>"`  : eigen User-Agent string

Voorbeeld:
```bash
node scripts/fill-pois-from-wikipedia.mjs --dry-run
node scripts/fill-pois-from-wikipedia.mjs --overwrite
```

## 2) Nieuwe POI-lijst exporteren uit Wikidata (Berlijn)
Dit script draait een SPARQL query op de Wikidata Query Service en schrijft een JSON-export weg.

```bash
node scripts/fetch-berlin-pois-wikidata.mjs --limit 200 --out wikidata-export.json --theme "Wikidata import"
```

> Let op: Wikidata kan ruis geven (zeker bij restaurants/bars). Zie dit vooral als "seed generator".

## Bronnen / techniek
- Wikidata Query Service SPARQL endpoint: https://query.wikidata.org/sparql
- Wikipedia MediaWiki API (pageprops → wikibase_item) en Wikidata API (wbgetentities claims)

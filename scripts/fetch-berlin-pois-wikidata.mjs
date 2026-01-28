#!/usr/bin/env node
/**
 * fetch-berlin-pois-wikidata.mjs
 *
 * Doel:
 * - Haal automatisch een lijst POI's uit Wikidata voor (groot) Berlijn
 * - Levert: JSON-array met { id, title, theme, lat, lng, info{nl,en}, image{commonsFile,sourcePage}, wikidataId }
 *
 * Gebruikt: Wikidata Query Service (SPARQL) endpoint.
 * Docs: https://query.wikidata.org/ en user manual / endpoints.
 *
 * Vereisten: Node.js 18+
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const outPath = args.out || path.resolve(process.cwd(), "wikidata-berlin-export.json");
const limit = Number(args.limit || 200);
const theme = args.theme || "Wikidata import";
const USER_AGENT = args.ua || "berlin-poi-planner-static/1.0 (https://github.com/; contact: you@example.com)";

/**
 * Types (instance of / subclasses) die vaak nuttige POI's geven.
 * Je kunt dit uitbreiden met extra Q-items.
 */
const TYPES = [
  "wd:Q570116",   // tourist attraction
  "wd:Q33506",    // museum
  "wd:Q4989906",  // monument
  "wd:Q179700",   // memorial
  "wd:Q16970",    // church (gives many; might be noisy)
  "wd:Q24354",    // theater
  "wd:Q132241",   // art gallery
  "wd:Q245068",   // historic site
  "wd:Q133056",   // park
  "wd:Q11707",    // restaurant (noisy)
  "wd:Q187456",   // bar (noisy)
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function commonsFilePage(file) {
  const safe = String(file).replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/File:${safe}`;
}

function slugId(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function sparql(query) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/sparql-results+json"
    }
  });
  if (!res.ok) throw new Error(`WDQS HTTP ${res.status}`);
  return res.json();
}

/**
 * In/near Berlin:
 * - We use wd:Q64 (Berlin) as administrative territory via P131* (located in the administrative territorial entity).
 *   This is imperfect but works decently for "in Berlin" places.
 * - Requires P625 coordinates.
 * - Optional P18 image.
 * - Optional sitelinks for nlwiki/enwiki.
 */
function buildQuery() {
  const typeValues = TYPES.join(" ");
  return `
SELECT ?item ?itemLabel ?coord ?image ?nlwiki ?enwiki WHERE {
  VALUES ?type { ${typeValues} }
  ?item wdt:P31/wdt:P279* ?type .
  ?item wdt:P625 ?coord .
  ?item (wdt:P131)* wd:Q64 .

  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?nlwiki schema:about ?item ; schema:isPartOf <https://nl.wikipedia.org/> ; schema:name ?nlwiki . }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki . }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
}
LIMIT ${limit}
`;
}

function parseCoord(wkt) {
  // WKT is like "Point(13.4050 52.5200)"
  const m = String(wkt).match(/Point\(([-0-9.]+)\s+([-0-9.]+)\)/i);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function main() {
  const q = buildQuery();
  const data = await sparql(q);
  const bindings = data?.results?.bindings || [];

  const out = [];
  for (const b of bindings) {
    const itemUrl = b.item?.value;
    const qid = itemUrl ? itemUrl.split("/").pop() : null;
    const label = b.itemLabel?.value || qid || "Onbekend";
    const coord = parseCoord(b.coord?.value);
    if (!qid || !coord) continue;

    const commonsFile = b.image?.value
      ? decodeURIComponent(b.image.value.split("/Special:FilePath/")[1] || "").replace(/_/g, " ")
      : null;

    const nlTitle = b.nlwiki?.value || null;
    const enTitle = b.enwiki?.value || null;

    const poi = {
      id: slugId(label) + "-" + qid.toLowerCase(),
      title: label,
      theme,
      lat: coord.lat,
      lng: coord.lng,
      wikidataId: qid,
      info: {
        ...(nlTitle ? { nl: `https://nl.wikipedia.org/wiki/${encodeURIComponent(nlTitle).replace(/%20/g, "_")}` } : {}),
        ...(enTitle ? { en: `https://en.wikipedia.org/wiki/${encodeURIComponent(enTitle).replace(/%20/g, "_")}` } : {})
      },
      image: commonsFile ? { commonsFile, sourcePage: commonsFilePage(commonsFile) } : {}
    };

    out.push(poi);
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Geschreven: ${outPath}`);
  console.log(`Items: ${out.length}`);
  console.log(`Tip: merge handmatig of bouw een eigen merge-script.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

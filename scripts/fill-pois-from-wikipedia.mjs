#!/usr/bin/env node
/**
 * fill-pois-from-wikipedia.mjs
 *
 * Doel:
 * - Lees ./pois.json
 * - Voor POI's met info.nl of info.en dat een Wikipedia-link is:
 *   - Vind Wikidata QID via MediaWiki API (pageprops: wikibase_item)
 *   - Haal P625 (coördinaten) en P18 (Commons afbeelding) op via Wikidata API
 *   - Vul ontbrekende lat/lng en image.commonsFile (optioneel overschrijven met --overwrite)
 * - Schrijf terug naar pois.json (of naar een ander bestand met --out)
 *
 * Vereisten: Node.js 18+ (fetch ingebouwd)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.in || path.resolve(process.cwd(), "pois.json");
const outPath = args.out || inputPath;
const overwrite = Boolean(args.overwrite);
const dryRun = Boolean(args["dry-run"]);

const USER_AGENT = args.ua || "berlin-poi-planner-static/1.0 (https://github.com/; contact: you@example.com)";

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

function isWikipediaUrl(u) {
  return typeof u === "string" && /https?:\/\/(nl|en)\.wikipedia\.org\/wiki\//i.test(u);
}
function parseWikipedia(u) {
  // returns { lang, title }
  const m = u.match(/https?:\/\/(nl|en)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  const lang = m[1].toLowerCase();
  // Wikipedia titles are URL-encoded; replace underscores; keep encoded for API
  const title = decodeURIComponent(m[2]).replace(/_/g, " ");
  return { lang, title };
}

async function mwGetQid({ lang, title }) {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const url = new URL(endpoint);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("prop", "pageprops");
  url.searchParams.set("ppprop", "wikibase_item");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", title);

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Wikipedia API ${lang} HTTP ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const firstKey = Object.keys(pages)[0];
  const page = pages[firstKey];
  const qid = page?.pageprops?.wikibase_item || null;
  return qid;
}

async function wdGetClaims(qid) {
  const endpoint = "https://www.wikidata.org/w/api.php";
  const url = new URL(endpoint);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("ids", qid);
  url.searchParams.set("props", "claims|sitelinks|labels");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Wikidata API HTTP ${res.status}`);
  const data = await res.json();
  const ent = data?.entities?.[qid];
  if (!ent) return null;

  // P625 coordinates
  let coords = null;
  const c = ent?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  if (c && typeof c.latitude === "number" && typeof c.longitude === "number") {
    coords = { lat: c.latitude, lng: c.longitude };
  }

  // P18 image file name (Commons)
  let commonsFile = null;
  const img = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof img === "string" && img.length) commonsFile = img;

  return { coords, commonsFile, qid };
}

function commonsFilePage(file) {
  const safe = String(file).replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/File:${safe}`;
}

function shouldFill(current, next) {
  if (next == null) return false;
  if (overwrite) return true;
  if (current == null) return true;
  if (typeof current === "string" && current.trim() === "") return true;
  return false;
}

async function main() {
  const raw = fs.readFileSync(inputPath, "utf-8");
  const pois = JSON.parse(raw);

  let changed = 0;
  let scanned = 0;
  const errors = [];

  for (const p of pois) {
    const url = (p?.info?.nl && isWikipediaUrl(p.info.nl)) ? p.info.nl
             : (p?.info?.en && isWikipediaUrl(p.info.en)) ? p.info.en
             : null;
    if (!url) continue;

    scanned++;
    const parsed = parseWikipedia(url);
    if (!parsed) continue;

    try {
      const qid = await mwGetQid(parsed);
      if (!qid) continue;

      const claims = await wdGetClaims(qid);
      if (!claims) continue;

      // store qid
      if (shouldFill(p.wikidataId, qid)) p.wikidataId = qid;

      // coords
      if (claims.coords) {
        if (shouldFill(p.lat, claims.coords.lat)) p.lat = claims.coords.lat;
        if (shouldFill(p.lng, claims.coords.lng)) p.lng = claims.coords.lng;
      }

      // image
      if (claims.commonsFile) {
        p.image = p.image || {};
        if (shouldFill(p.image.commonsFile, claims.commonsFile)) {
          p.image.commonsFile = claims.commonsFile;
        }
        // keep sourcePage consistent
        if (p.image.commonsFile && shouldFill(p.image.sourcePage, commonsFilePage(p.image.commonsFile))) {
          p.image.sourcePage = commonsFilePage(p.image.commonsFile);
        }
      }

      changed++;
      console.log(`✓ ${p.id}: ${qid}${claims.coords ? " (coords)" : ""}${claims.commonsFile ? " (P18)" : ""}`);
    } catch (e) {
      errors.push({ id: p?.id, err: String(e?.message || e) });
      console.warn(`! ${p?.id}: ${String(e?.message || e)}`);
    }
  }

  if (dryRun) {
    console.log(`\nDRY RUN — niets geschreven.`);
  } else {
    fs.writeFileSync(outPath, JSON.stringify(pois, null, 2), "utf-8");
    console.log(`\nGeschreven: ${outPath}`);
  }

  console.log(`\nSamenvatting: ${scanned} POI's gescand, ${changed} verwerkt, ${errors.length} errors.`);
  if (errors.length) {
    console.log("Errors:");
    for (const e of errors.slice(0, 20)) console.log(`- ${e.id}: ${e.err}`);
    if (errors.length > 20) console.log(`- ... +${errors.length - 20} meer`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

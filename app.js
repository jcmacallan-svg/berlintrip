const FAVORITES_KEY = "berlin-poi-favorites-v1";
const ROUTE_KEY = "berlin-poi-route-v1";

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}
function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}
function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function saveArray(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function pickInfoUrl(info) {
  if (!info) return null;
  return info.nl || info.en || null;
}

function commonsFilePath(file) {
  const safe = encodeURIComponent(String(file).replace(/ /g, "_"));
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${safe}`;
}
function commonsFilePage(file) {
  const safe = encodeURIComponent(String(file).replace(/ /g, "_"));
  return `https://commons.wikimedia.org/wiki/File:${safe}`;
}


const PHOTO_CACHE_KEY = "berlin-poi-photo-cache-v1"; // id -> { commonsFile, sourcePage, ts }
const photoCache = loadObject(PHOTO_CACHE_KEY);

function loadObject(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function saveObject(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

async function ensurePhoto(poi) {
  // If we already have a commonsFile, we're done.
  if (poi?.image?.commonsFile) return true;

  // Check cache
  const cached = photoCache[poi.id];
  if (cached) {
    poi.image = poi.image || {};
    if (cached.commonsFile) {
      poi.image.commonsFile = cached.commonsFile;
      poi.image.sourcePage = cached.sourcePage || commonsFilePage(cached.commonsFile);
      return true;
    }
    if (cached.url) {
      poi.image.url = cached.url;
      poi.image.sourcePage = cached.sourcePage || (poi.info?.nl || poi.info?.en || null);
      return true;
    }
  }

  // Try: if wikidataId exists, fetch claims.
  let qid = poi.wikidataId || null;

  // Else: try Wikipedia link -> QID
  const wikiUrl = (poi?.info?.nl && isWikipediaUrl(poi.info.nl)) ? poi.info.nl
               : (poi?.info?.en && isWikipediaUrl(poi.info.en)) ? poi.info.en
               : null;

  try {
    if (!qid && wikiUrl) {
      const parsed = parseWikipedia(wikiUrl);
      if (parsed) qid = await mwGetQid(parsed);
      if (qid) poi.wikidataId = qid;
    }

    if (!qid) return false;

    const claims = await wdGetClaims(qid);
    if (claims?.commonsFile) {
      poi.image = poi.image || {};
      poi.image.commonsFile = claims.commonsFile;
      poi.image.sourcePage = commonsFilePage(claims.commonsFile);
      photoCache[poi.id] = { commonsFile: claims.commonsFile, sourcePage: poi.image.sourcePage, ts: Date.now() };
      saveObject(PHOTO_CACHE_KEY, photoCache);
      return true;
    }
  } catch {
    // ignore
  }
  // Fallback: Wikipedia page image (thumbnail) even if no P18 exists
  if (wikiUrl) {
    try {
      const parsed = parseWikipedia(wikiUrl);
      if (parsed) {
        const endpoint = `https://${parsed.lang}.wikipedia.org/w/api.php`;
        const url = new URL(endpoint);
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("origin", "*");
        url.searchParams.set("prop", "pageimages");
        url.searchParams.set("pithumbsize", "640");
        url.searchParams.set("redirects", "1");
        url.searchParams.set("titles", parsed.title);

        const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
        if (res.ok) {
          const data = await res.json();
          const pages = data?.query?.pages;
          const key = pages ? Object.keys(pages)[0] : null;
          const page = key ? pages[key] : null;
          const thumbUrl = page?.thumbnail?.source || null;
          const fileTitle = page?.pageimage || null; // filename without "File:"
          if (thumbUrl) {
            poi.image = poi.image || {};
            poi.image.url = thumbUrl;
            // Link to file page if we know the filename, otherwise to the article
            if (fileTitle) {
              poi.image.sourcePage = `https://${parsed.lang}.wikipedia.org/wiki/File:${encodeURIComponent(String(fileTitle).replace(/ /g, "_"))}`;
            } else {
              poi.image.sourcePage = wikiUrl;
            }
            photoCache[poi.id] = { url: poi.image.url, sourcePage: poi.image.sourcePage, ts: Date.now() };
            saveObject(PHOTO_CACHE_KEY, photoCache);
            return true;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

 // Minimal MediaWiki/Wikidata helpers (browser-side)
function isWikipediaUrl(u) {
  return typeof u === "string" && /https?:\/\/(nl|en)\.wikipedia\.org\/wiki\//i.test(u);
}
function parseWikipedia(u) {
  const m = String(u).match(/https?:\/\/(nl|en)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  const lang = m[1].toLowerCase();
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
  const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const firstKey = Object.keys(pages)[0];
  const page = pages[firstKey];
  return page?.pageprops?.wikibase_item || null;
}
async function wdGetClaims(qid) {
  const endpoint = "https://www.wikidata.org/w/api.php";
  const url = new URL(endpoint);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("ids", qid);
  url.searchParams.set("props", "claims");
  const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const ent = data?.entities?.[qid];
  if (!ent) return null;

  // P18 only for runtime photo fill (coords are already in dataset, but could be extended)
  let commonsFile = null;
  const img = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof img === "string" && img.length) commonsFile = img;
  return { commonsFile };
}


let allPois = [];
let filteredPois = [];
let favorites = loadSet(FAVORITES_KEY);
let routeIds = loadArray(ROUTE_KEY);

let map, markersLayer, routingControl = null;
let routeLine = null;

// Hotel marker (Leonardo Hotel Berlin Mitte, Bertolt-Brecht-Platz 4)
// Coords are approximate for the address and work well for routing display.
const HOTEL = { name: "Leonardo Hotel Berlin Mitte", lat: 52.5226, lng: 13.38635 };
let hotelMarker = null;


const elTheme = document.getElementById("themeSelect");
const elSearch = document.getElementById("searchBox");
const elList = document.getElementById("poiList");
const elDetails = document.getElementById("details");
const elRouteList = document.getElementById("routeList");
const elRouteSummary = document.getElementById("routeSummary");
const btnClearRoute = document.getElementById("clearRouteBtn");
const btnRouteFromFav = document.getElementById("routeFromFavoritesBtn");
const orsKeyInput = document.getElementById("orsKeyInput");
const optimizeRouteBtn = document.getElementById("optimizeRouteBtn");
const startAtHotelChk = document.getElementById("startAtHotelChk");

function initMap() {
  map = L.map("map").setView([52.52, 13.405], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // Hotel marker in red
  hotelMarker = L.circleMarker([HOTEL.lat, HOTEL.lng], {
    radius: 8,
    color: "#ff4d4d",
    weight: 2,
    fillColor: "#ff4d4d",
    fillOpacity: 0.7
  }).addTo(map);
  hotelMarker.bindPopup(`<b>${escapeHtml(HOTEL.name)}</b><br/><small>Bertolt-Brecht-Platz (Mitte)</small>`);
}


function setThemeOptions() {
  const themes = [...new Set(allPois.map(p => p.theme))].sort((a,b)=>a.localeCompare(b, "nl"));
  const options = ["Alle thema's", ...themes];

  elTheme.innerHTML = options.map(t => `<option value="${t}">${t}</option>`).join("");
}

function applyFilters() {
  const theme = elTheme.value;
  const q = elSearch.value.trim().toLowerCase();

  filteredPois = allPois.filter(p => {
    const themeOk = (theme === "Alle thema's") ? true : p.theme === theme;
    const qOk = q ? String(p.title).toLowerCase().includes(q) : true;
    return themeOk && qOk;
  });

  renderList();
  renderMarkers();
}

function renderMarkers() {
  markersLayer.clearLayers();

  filteredPois.forEach(p => {
    const marker = L.marker([p.lat, p.lng]).addTo(markersLayer);
    marker.on("click", () => showDetails(p.id));
    marker.bindPopup(`<b>${escapeHtml(p.title)}</b><br/><small>${escapeHtml(p.theme)}</small>`);
  });
}

function renderList() {
  if (!filteredPois.length) {
    elList.innerHTML = `<small>Geen resultaten.</small>`;
    return;
  }

  elList.innerHTML = filteredPois.map(p => {
    const isFav = favorites.has(p.id);
    const imgFile = p.image && p.image.commonsFile ? p.image.commonsFile : null;
    const thumb = (p.image && p.image.url) ? p.image.url : (imgFile ? commonsFilePath(imgFile) : null);
    const imgLink = (p.image && p.image.sourcePage) ? p.image.sourcePage : (imgFile ? commonsFilePage(imgFile) : null);

    return `
      <div class="poi" data-id="${p.id}">
        <div>
          ${thumb ? `
            <a href="${imgLink}" target="_blank" rel="noreferrer" title="Open bronpagina afbeelding">
              <img class="thumb" src="${thumb}" alt="${escapeAttr(p.title)}" loading="lazy"/>
            </a>
          ` : `
            <div class="thumb" title="Geen afbeelding beschikbaar"></div>
          `}
        </div>
        <div>
          <div class="poi-title">${escapeHtml(p.title)}</div>
          <div class="poi-meta">
            <span class="badge">${escapeHtml(p.theme)}</span>
            ${isFav ? `<span class="badge">★ favoriet</span>` : ``}
          </div>
          <div class="poi-actions">
            <button class="btn-details">Details</button>
            <button class="btn-fav" title="Markeer als favoriet">${isFav ? "★" : "☆"}</button>
            <button class="btn-add-route" title="Voeg toe aan route">+ route</button>
          </div>
        </div>
      </div>
    `;
  }).join("");


  // Lazy-fill missing photos via Wikidata/Wikipedia (client-side) and re-render once fetched
  for (const p of filteredPois) {
    if (!(p.image && p.image.commonsFile)) {
      ensurePhoto(p).then((ok) => {
        if (ok) {
          // Only re-render if current filters still include this item
          const still = filteredPois.find(x => x.id === p.id);
          if (still) renderList();
        }
      });
    }
  }

  // Event delegation
  elList.querySelectorAll(".poi").forEach(card => {
    const id = card.getAttribute("data-id");
    card.querySelector(".btn-details").addEventListener("click", () => showDetails(id));
    card.querySelector(".btn-fav").addEventListener("click", () => toggleFavorite(id));
    card.querySelector(".btn-add-route").addEventListener("click", () => addToRoute(id));
  });
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveSet(FAVORITES_KEY, favorites);
  renderList();
}

function addToRoute(id) {
  if (!routeIds.includes(id)) routeIds.push(id);
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
}

function removeFromRoute(id) {
  routeIds = routeIds.filter(x => x !== id);
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
}

function moveRoute(id, dir) {
  const idx = routeIds.indexOf(id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= routeIds.length) return;
  const copy = [...routeIds];
  [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
  routeIds = copy;
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
}


function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function optimizeRoute(ids) {
  const pts = ids.map(id => allPois.find(p => p.id === id)).filter(Boolean);
  if (pts.length <= 2) return ids;

  const startAtHotel = startAtHotelChk ? startAtHotelChk.checked : true;
  const start = startAtHotel ? { lat: HOTEL.lat, lng: HOTEL.lng } : { lat: pts[0].lat, lng: pts[0].lng };

  const remaining = [...pts];
  const ordered = [];

  let cur = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur, remaining[i]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cur = next;
  }
  return ordered.map(p => p.id);
}

function renderRouteList() {
  if (!routeIds.length) {
    elRouteList.innerHTML = "";
    elRouteSummary.innerHTML = "<small>Geen route (minimaal 2 stops).</small>";
    return;
  }
  elRouteList.innerHTML = routeIds.map(id => {
    const p = allPois.find(x => x.id === id);
    if (!p) return "";
    return `
      <li>
        <button class="rt-jump" data-id="${id}" title="Zoom naar POI">${escapeHtml(p.title)}</button>
        <button class="rt-up" data-id="${id}" title="Omhoog">↑</button>
        <button class="rt-down" data-id="${id}" title="Omlaag">↓</button>
        <button class="rt-del" data-id="${id}" title="Verwijderen">x</button>
      </li>
    `;
  }).join("");

  elRouteList.querySelectorAll(".rt-jump").forEach(b => b.addEventListener("click", () => showDetails(b.dataset.id, true)));
  elRouteList.querySelectorAll(".rt-up").forEach(b => b.addEventListener("click", () => moveRoute(b.dataset.id, -1)));
  elRouteList.querySelectorAll(".rt-down").forEach(b => b.addEventListener("click", () => moveRoute(b.dataset.id, +1)));
  elRouteList.querySelectorAll(".rt-del").forEach(b => b.addEventListener("click", () => removeFromRoute(b.dataset.id)));
}

function clearRouteVisuals() {
  if (routingControl) {
    try { map.removeControl(routingControl); } catch {}
    routingControl = null;
  }
  if (routeLine) {
    try { routeLine.remove(); } catch {}
    routeLine = null;
  }
}

async function drawRoute() {
  clearRouteVisuals();

  const points = routeIds
    .map(id => allPois.find(p => p.id === id))
    .filter(Boolean)
    .map(p => ({ lat: p.lat, lng: p.lng, id: p.id }));

  if (points.length < 2) {
    elRouteSummary.innerHTML = "<small>Geen route (minimaal 2 stops).</small>";
    return;
  }

  const startAtHotel = startAtHotelChk ? startAtHotelChk.checked : true;
  const waypoints = startAtHotel ? [{ lat: HOTEL.lat, lng: HOTEL.lng, id: "hotel" }, ...points] : points;

  // If ORS key is present, use ORS foot-walking GeoJSON directions
  const orsKey = (localStorage.getItem("berlin-poi-ors-key-v1") || "").trim();

  if (orsKey) {
    try {
      const coords = waypoints.map(w => [w.lng, w.lat]); // ORS expects [lng, lat]
      const res = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
        method: "POST",
        headers: {
          "Authorization": orsKey,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ coordinates: coords })
      });

      if (!res.ok) throw new Error(`ORS HTTP ${res.status}`);
      const geo = await res.json();

      routeLine = L.geoJSON(geo, {
        style: { weight: 5, opacity: 0.85 }
      }).addTo(map);

      const feat = geo?.features?.[0];
      const distM = feat?.properties?.summary?.distance;
      const km = (typeof distM === "number") ? distM / 1000 : null;

      if (km != null) {
        const walkMin = (km / (4.5 / 60));
        elRouteSummary.innerHTML = `<small>Route: ${km.toFixed(1)} km · ${Math.round(walkMin)} min (wandelen @ 4,5 km/u) · ORS foot-walking</small>`;
      } else {
        elRouteSummary.innerHTML = `<small>Route getekend (ORS). Tijd = wandelen @ 4,5 km/u.</small>`;
      }

      const b = routeLine.getBounds();
      if (b && b.isValid()) map.fitBounds(b.pad(0.2));
      return;
    } catch (e) {
      console.warn("ORS failed; fallback to OSRM", e);
    }
  }

  // Fallback: OSRM via Leaflet Routing Machine (may be driving-oriented)
  const lrWaypoints = waypoints.map(w => L.latLng(w.lat, w.lng));
  routingControl = L.Routing.control({
    waypoints: lrWaypoints,
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    show: false,
    router: L.Routing.osrmv1({ serviceUrl: "https://router.project-osrm.org/route/v1" })
  }).addTo(map);

  routingControl.on("routesfound", (e) => {
    const route = e.routes && e.routes[0];
    if (!route) return;
    const km = route.summary.totalDistance / 1000;
    const walkMin = (km / (4.5 / 60));
    elRouteSummary.innerHTML = `<small>Route: ${km.toFixed(1)} km · ${Math.round(walkMin)} min (wandelen @ 4,5 km/u) · OSRM fallback</small>`;
  });
}


function showDetails(id, panTo=false) {
  const p = allPois.find(x => x.id === id);
  if (!p) return;

  const infoUrl = pickInfoUrl(p.info);

  // Try to fill missing photo on demand
  if (!(p.image && p.image.commonsFile)) {
    ensurePhoto(p).then((ok) => {
      if (ok) showDetails(id, panTo);
    });
  }

  const imgFile = p.image && p.image.commonsFile ? p.image.commonsFile : null;
  const imgSrc = (p.image && p.image.url) ? p.image.url : (imgFile ? commonsFilePath(imgFile) : null);
  const imgPage = (p.image && p.image.sourcePage) ? p.image.sourcePage : (imgFile ? commonsFilePage(imgFile) : null);

  elDetails.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:flex-start;">
      <div>
        <div style="font-weight:750; font-size:14px; margin-bottom:4px;">${escapeHtml(p.title)}</div>
        <div><small>${escapeHtml(p.theme)}</small></div>
      </div>
      <button id="detailsFavBtn" title="Favoriet">${favorites.has(p.id) ? "★" : "☆"}</button>
    </div>

    ${imgSrc ? `
      <div style="margin-top:10px;">
        <a href="${imgPage}" target="_blank" rel="noreferrer" title="Open bronpagina van de afbeelding">
          <img src="${imgSrc}" alt="${escapeAttr(p.title)}" loading="lazy" />
        </a>
        <div style="margin-top:6px;">
          <small><a href="${imgPage}" target="_blank" rel="noreferrer">Afbeelding bron</a></small>
        </div>
      </div>
    ` : ``}

    <div style="margin-top:10px;">
      ${infoUrl ? `<a href="${infoUrl}" target="_blank" rel="noreferrer">Meer info (${p.info && p.info.nl ? "NL" : "EN"})</a>` : `<small>Geen info-link beschikbaar.</small>`}
      <div style="margin-top:8px;" class="poi-actions">
        <button id="detailsAddRouteBtn">+ route</button>
        <button id="detailsZoomBtn">Zoom</button>
      </div>
    </div>
  `;

  document.getElementById("detailsFavBtn").addEventListener("click", () => {
    toggleFavorite(p.id);
    showDetails(p.id, panTo);
  });
  document.getElementById("detailsAddRouteBtn").addEventListener("click", () => addToRoute(p.id));
  document.getElementById("detailsZoomBtn").addEventListener("click", () => {
    map.setView([p.lat, p.lng], 15);
  });

  if (panTo) map.setView([p.lat, p.lng], 15);
}

btnClearRoute.addEventListener("click", () => {
  routeIds = [];
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
});

btnRouteFromFav.addEventListener("click", () => {
  // Fill route with favorites that match current filter/search ordering
  const ids = filteredPois.map(p => p.id).filter(id => favorites.has(id));
  routeIds = optimizeRoute(ids);
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
});

elTheme.addEventListener("change", applyFilters);
elSearch.addEventListener("input", applyFilters);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function main() {
  initMap();

  const res = await fetch("./pois.json", { cache: "no-store" });
  allPois = await res.json();

  // Ensure deterministic ordering
  allPois.sort((a,b) => (a.theme + " " + a.title).localeCompare(b.theme + " " + b.title, "nl"));

  setThemeOptions();
  applyFilters();


  // Sidebar width slider + draggable splitter (desktop)
  const slider = document.getElementById("sidebarSlider");
  const splitter = document.getElementById("splitter");
  const SIDEBAR_W_KEY = "berlin-poi-sidebarW-v1";

  function setSidebarWidth(px) {
    const v = Math.max(280, Math.min(820, px));
    document.documentElement.style.setProperty("--sidebarW", v + "px");
    if (slider) slider.value = String(v);
    localStorage.setItem(SIDEBAR_W_KEY, String(v));
  }

  const savedW = Number(localStorage.getItem(SIDEBAR_W_KEY));
  if (Number.isFinite(savedW) && savedW > 0) setSidebarWidth(savedW);

  if (slider) {
    slider.addEventListener("input", () => setSidebarWidth(Number(slider.value)));
  }

  if (splitter) {
    let dragging = false;
    splitter.addEventListener("mousedown", () => { dragging = true; document.body.style.cursor = "col-resize"; });
    window.addEventListener("mouseup", () => { dragging = false; document.body.style.cursor = ""; });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      // sidebar width = mouse x
      setSidebarWidth(e.clientX);
      // Leaflet needs invalidateSize when container changes
      setTimeout(() => map && map.invalidateSize(), 0);
    });

    // touch support
    splitter.addEventListener("touchstart", () => { dragging = true; });
    window.addEventListener("touchend", () => { dragging = false; });
    window.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      setSidebarWidth(t.clientX);
      setTimeout(() => map && map.invalidateSize(), 0);
    }, { passive: true });
  }

  renderRouteList();

  // ORS API key (optional) stored locally
  const ORS_KEY_STORAGE = "berlin-poi-ors-key-v1";
  if (orsKeyInput) {
    const savedKey = localStorage.getItem(ORS_KEY_STORAGE) || "";
    orsKeyInput.value = savedKey;
    orsKeyInput.addEventListener("change", () => {
      localStorage.setItem(ORS_KEY_STORAGE, orsKeyInput.value.trim());
      drawRoute();
    });
  }
  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener("click", () => {
      routeIds = optimizeRoute(routeIds);
      saveArray(ROUTE_KEY, routeIds);
      renderRouteList();
      drawRoute();
    });
  }

  drawRoute();
}

main();

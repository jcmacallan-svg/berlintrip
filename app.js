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

let allPois = [];
let filteredPois = [];
let favorites = loadSet(FAVORITES_KEY);
let routeIds = loadArray(ROUTE_KEY);

let map, markersLayer, routingControl = null;
let mapInitialized = false;
const elApp = document.getElementById("app");
const elMapWrap = document.getElementById("mapWrap");

const elTheme = document.getElementById("themeSelect");
const elSearch = document.getElementById("searchBox");
const elList = document.getElementById("poiList");
const elDetails = document.getElementById("details");
const elRouteList = document.getElementById("routeList");
const elRouteSummary = document.getElementById("routeSummary");
const btnClearRoute = document.getElementById("clearRouteBtn");
const btnRouteFromFav = document.getElementById("routeFromFavoritesBtn");
const toggleMapBtn = document.getElementById("toggleMapBtn");


function showMap() {
  if (elApp) elApp.classList.remove("map-hidden");
  if (elMapWrap) elMapWrap.classList.remove("is-hidden");
  if (toggleMapBtn) toggleMapBtn.textContent = "Verberg kaart";

  if (!mapInitialized) {
    initMap();
    mapInitialized = true;
    // Markers depend on current filter
    renderMarkers();
    // Ensure proper sizing
    setTimeout(() => map && map.invalidateSize(), 0);
  } else {
    setTimeout(() => map && map.invalidateSize(), 0);
  }
}

function hideMap() {
  if (elApp) elApp.classList.add("map-hidden");
  if (elMapWrap) elMapWrap.classList.add("is-hidden");
  if (toggleMapBtn) toggleMapBtn.textContent = "Toon kaart";
}

function initMap() {
  map = L.map("map").setView([52.52, 13.405], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
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
  if (mapInitialized) renderMarkers();
}

function renderMarkers() {
  markersLayer.clearLayers();

  filteredPois.forEach(p => {
    const marker = L.marker([p.lat, p.lng]).addTo(markersLayer);
    marker.on("click", () => showDetails(p.id));
    marker.bindPopup(`<b>${escapeHtml(p.title)}</b><br/><small>${escapeHtml(p.theme)}</small>`);
  });
}


// --- Performance-friendly photo loading (lazy + throttled) ---
function cssEscape(s){
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

const PHOTO_QUEUE = [];
let photoInFlight = 0;
const PHOTO_CONCURRENCY = 2;

function enqueuePhoto(id) {
  if (PHOTO_QUEUE.includes(id)) return;
  PHOTO_QUEUE.push(id);
  pumpPhotoQueue();
}

async function pumpPhotoQueue() {
  if (photoInFlight >= PHOTO_CONCURRENCY) return;
  const id = PHOTO_QUEUE.shift();
  if (!id) return;

  const p = filteredPois.find(x => x.id === id) || allPois.find(x => x.id === id);
  if (!p) return;

  if (p.image && (p.image.commonsFile || p.image.url)) {
    pumpPhotoQueue();
    return;
  }

  photoInFlight++;
  try {
    const ok = await ensurePhoto(p);
    if (ok) {
      const card = document.querySelector(`.poi[data-id="${cssEscape(p.id)}"]`);
      if (card) {
        const imgFile = p.image && p.image.commonsFile ? p.image.commonsFile : null;
        const thumb = (p.image && p.image.url) ? p.image.url : (imgFile ? commonsFilePath(imgFile) : null);
        const imgLink = (p.image && p.image.sourcePage) ? p.image.sourcePage : (imgFile ? commonsFilePage(imgFile) : null);
        if (thumb) {
          const left = card.firstElementChild;
          if (left) {
            left.innerHTML = `
              <a href="${imgLink}" target="_blank" rel="noreferrer" title="Open bronpagina afbeelding">
                <img class="thumb" src="${thumb}" alt="${escapeAttr(p.title)}" loading="lazy"/>
              </a>
            `;
          }
        }
      }
    }
  } finally {
    photoInFlight--;
    pumpPhotoQueue();
  }
}

let poiObserver = null;
function initPoiObserver() {
  if (poiObserver) return;
  if (!("IntersectionObserver" in window)) return;

  poiObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const id = e.target.getAttribute("data-id");
        if (id) enqueuePhoto(id);
        poiObserver.unobserve(e.target);
      }
    }
  }, { root: document.getElementById("sidebar"), threshold: 0.15 });
}

function renderList() {
  if (!filteredPois.length) {
    elList.innerHTML = `<small>Geen resultaten.</small>`;
    return;
  }

  elList.innerHTML = filteredPois.map(p => {
    const isFav = favorites.has(p.id);
    const imgFile = p.image && p.image.commonsFile ? p.image.commonsFile : null;
    const thumb = imgFile ? commonsFilePath(imgFile) : null;
    const imgLink = imgFile ? (p.image.sourcePage || commonsFilePage(imgFile)) : null;

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

  // Event delegation
  elList.querySelectorAll(".poi").forEach(card => {
    const id = card.getAttribute("data-id");
    card.querySelector(".btn-details").addEventListener("click", () => showDetails(id));
    card.querySelector(".btn-fav").addEventListener("click", () => toggleFavorite(id));
    card.querySelector(".btn-add-route").addEventListener("click", () => addToRoute(id));
  });

  // Lazy-load photos only for visible cards (fast + smooth)
  initPoiObserver();
  if (poiObserver) {
    elList.querySelectorAll(".poi").forEach(card => poiObserver.observe(card));
  }
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
  drawRoute();
}

function removeFromRoute(id) {
  routeIds = routeIds.filter(x => x !== id);
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();
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
  drawRoute();
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

function drawRoute() {
  if (routingControl) {
    try { map.removeControl(routingControl); } catch {}
    routingControl = null;
  }

  const points = routeIds
    .map(id => allPois.find(p => p.id === id))
    .filter(Boolean)
    .map(p => L.latLng(p.lat, p.lng));

  if (points.length < 2) {
    elRouteSummary.innerHTML = "<small>Geen route (minimaal 2 stops).</small>";
    return;
  }

  // OSRM demo endpoint; prima voor persoonlijk gebruik.
  routingControl = L.Routing.control({
    waypoints: points,
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
    const min = route.summary.totalTime / 60;
    elRouteSummary.innerHTML = `<small>Route: ${km.toFixed(1)} km · ${Math.round(min)} min (schatting)</small>`;
  });
}

function showDetails(id, panTo=false) {
  const p = allPois.find(x => x.id === id);
  if (!p) return;

  const infoUrl = pickInfoUrl(p.info);
  const imgFile = p.image && p.image.commonsFile ? p.image.commonsFile : null;
  const imgSrc = imgFile ? commonsFilePath(imgFile) : null;
  const imgPage = imgFile ? (p.image.sourcePage || commonsFilePage(imgFile)) : null;

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
    if (!mapInitialized) showMap();
    if (map) map.setView([p.lat, p.lng], 15);
  });

  if (panTo && mapInitialized) map.setView([p.lat, p.lng], 15);
}

if (toggleMapBtn) {
  toggleMapBtn.addEventListener("click", () => {
    const hidden = elMapWrap && elMapWrap.classList.contains("is-hidden");
    if (hidden) showMap(); else hideMap();
  });
}

btnClearRoute.addEventListener("click", () => {
  routeIds = [];
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();
  drawRoute();
});

btnRouteFromFav.addEventListener("click", () => {
  // Fill route with favorites that match current filter/search ordering
  const ids = filteredPois.map(p => p.id).filter(id => favorites.has(id));
  routeIds = ids;
  saveArray(ROUTE_KEY, routeIds);
  renderRouteList();
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
  // Start in list mode (no map) for speed
  if (elApp) elApp.classList.add("map-hidden");
  if (elMapWrap) elMapWrap.classList.add("is-hidden");
  initMap();

  const res = await fetch("./pois.json", { cache: "no-store" });
  allPois = await res.json();

  // Ensure deterministic ordering
  allPois.sort((a,b) => (a.theme + " " + a.title).localeCompare(b.theme + " " + b.title, "nl"));

  setThemeOptions();
  applyFilters();

  renderRouteList();
  drawRoute();
}

main();

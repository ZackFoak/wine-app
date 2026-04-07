import { state } from "./state.js";
import { byId, debounce, loadJson, saveFavorites, parseFavorite, saveStudiedPages, isStudiedPage } from "./utils.js";
import { setBreadcrumb, setPanelTitle, showLoading } from "./ui.js";
import { startQuiz, buildGeneratedQuestions, startCustomQuiz } from "./quiz.js";

let recent = JSON.parse(localStorage.getItem("wineRecent") || "[]");

const speechState = {
  preferredVoice: null,
  voicesPromise: null
};
let mapCenterTimer = null;
let markerLayoutTimer = null;

const REGION_CATEGORY_RULES = {
  sparkling: new Set([
    "france::champagne",
    "france::alsace",
    "france::burgundy",
    "france::anjou-saumur",
    "france::touraine",
    "italy::veneto",
    "italy::piemonte",
    "spain::penedes",
    "australia::adelaide-hills",
    "australia::yarra-valley",
    "australia::tasmania",
    "new-zealand::marlborough",
    "south-africa::stellenbosch",
    "usa::california"
  ]),
  fortified: new Set([
    "france::southern-rhone",
    "spain::jerez",
    "portugal::douro",
    "australia::rutherglen"
  ]),
  stillOnlyExclusions: new Set([
    "france::champagne",
    "spain::penedes",
    "spain::jerez",
    "australia::rutherglen"
  ])
};

const WSET_CLIMATE_OPTIONS = [
  "Cool Maritime",
  "Moderate Maritime",
  "Warm Maritime",
  "Cool Continental",
  "Moderate Continental",
  "Warm Continental",
  "Cool Mediterranean",
  "Moderate Mediterranean",
  "Warm Mediterranean"
];

function saveRecent() {
  localStorage.setItem("wineRecent", JSON.stringify(recent));
}

function renderPronounceButton(text, label = text) {
  const safeText = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const safeLabel = String(label || text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
    <button
      class="pronounce-btn"
      type="button"
      data-pronounce="${safeText}"
      aria-label="Pronounce ${safeLabel}"
      title="Pronounce ${safeLabel}"
    >
      🔊
    </button>
  `;
}

function renderStudyList(title, items = []) {
  if (!Array.isArray(items) || !items.length) return "";

  return `
    <p><b>${title}:</b></p>
    <ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>
  `;
}

function pickPreferredVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(voice =>
    /^en(-|_)?/i.test(voice.lang) && /google|samantha|daniel|serena|alex|ava|victoria|karen/i.test(voice.name)
  ) || voices.find(voice => /^en(-|_)?/i.test(voice.lang)) || null;
}

function ensureSpeechVoiceReady() {
  if (!("speechSynthesis" in window)) {
    return Promise.resolve(null);
  }

  if (speechState.preferredVoice) {
    return Promise.resolve(speechState.preferredVoice);
  }

  const existingVoice = pickPreferredVoice();
  if (existingVoice) {
    speechState.preferredVoice = existingVoice;
    return Promise.resolve(existingVoice);
  }

  if (speechState.voicesPromise) {
    return speechState.voicesPromise;
  }

  speechState.voicesPromise = new Promise(resolve => {
    const synth = window.speechSynthesis;

    const finish = () => {
      speechState.preferredVoice = pickPreferredVoice();
      resolve(speechState.preferredVoice);
    };

    const handleVoicesChanged = () => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      finish();
    };

    synth.addEventListener("voiceschanged", handleVoicesChanged);

    window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      finish();
    }, 1200);
  }).finally(() => {
    speechState.voicesPromise = null;
  });

  return speechState.voicesPromise;
}

async function speakPronunciation(text) {
  const phrase = String(text || "").trim();
  if (!phrase || !("speechSynthesis" in window)) return;

  const preferredVoice = await ensureSpeechVoiceReady();
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(phrase);

  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang;
  } else {
    utterance.lang = "en-US";
  }

  utterance.rate = 0.92;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function bindPronounceButtons() {
  document.querySelectorAll("[data-pronounce]").forEach(btn => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void speakPronunciation(btn.dataset.pronounce);
    });
  });
}

function buildMapMarkerButton(label, {
  markerType = "region",
  selected = false
} = {}) {
  const safeLabel = String(label || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const classes = [
    markerType === "country" ? "country-map-marker" : "region-map-marker"
  ];

  if (markerType === "subregion") {
    classes.push("subregion-map-marker");
  }

  if (selected) {
    classes.push("is-selected");
  }

  return `<button class="${classes.join(" ")}" type="button">${safeLabel}</button>`;
}

// ================= MAP =================
const map = L.map("map").setView([25, 10], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function renderHomePanel() {
  setPanelTitle("Click a country");
  setBreadcrumb([]);
  byId("content").innerHTML = `
    <div class="section-card">
      <p class="section-title">Welcome</p>
      <p>Explore wine countries, then choose a region to open its details.</p>
      <p>Use Search, Quiz, Favorites, and Progress to build your knowledge.</p>
    </div>
  `;
}

function clearRegionMarkers() {
  state.regionMarkers.forEach(marker => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  state.regionMarkers = [];
  state.activeCountryKey = null;
}

function clearSubregionMarkers() {
  state.subregionMarkers.forEach(marker => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  state.subregionMarkers = [];
}

function clearRegionBoundaryLayer() {
  if (state.regionBoundaryLayer && map.hasLayer(state.regionBoundaryLayer)) {
    map.removeLayer(state.regionBoundaryLayer);
  }

  state.regionBoundaryLayer = null;
}

function clearSubregionBoundaryLayer() {
  if (state.subregionBoundaryLayer && map.hasLayer(state.subregionBoundaryLayer)) {
    map.removeLayer(state.subregionBoundaryLayer);
  }

  state.subregionBoundaryLayer = null;
}

function clearModeratingFactorLayer() {
  if (state.moderatingFactorLayer && map.hasLayer(state.moderatingFactorLayer)) {
    map.removeLayer(state.moderatingFactorLayer);
  }

  state.moderatingFactorLayer = null;
}

function getRegionCategories(countryKey, regionKey) {
  const id = `${countryKey}::${regionKey}`;
  const categories = new Set(["still"]);

  if (REGION_CATEGORY_RULES.sparkling.has(id)) {
    categories.add("sparkling");
  }

  if (REGION_CATEGORY_RULES.fortified.has(id)) {
    categories.add("fortified");
  }

  if (REGION_CATEGORY_RULES.stillOnlyExclusions.has(id)) {
    categories.delete("still");
  }

  return categories;
}

function getVisibleRegionEntries(countryKey, country) {
  const entries = Object.entries(country?.regions || {});

  if (state.currentFilter === "all") {
    return entries;
  }

  return entries.filter(([regionKey]) =>
    getRegionCategories(countryKey, regionKey).has(state.currentFilter)
  );
}

function hideAllCountryMarkers() {
  Object.values(state.markers).forEach(marker => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
}

function getVisibleMarkers() {
  if (state.subregionMarkers.length) {
    return state.subregionMarkers.filter(marker => map.hasLayer(marker));
  }

  if (state.regionMarkers.length) {
    return state.regionMarkers.filter(marker => map.hasLayer(marker));
  }

  return Object.values(state.markers).filter(marker => map.hasLayer(marker));
}

function clearMarkerOffsets(markers = []) {
  markers.forEach(marker => {
    const element = marker.getElement();
    if (!element) return;
    element.style.setProperty("--marker-shift-x", "0px");
    element.style.setProperty("--marker-shift-y", "0px");
    element.style.zIndex = "";
  });
}

function applyMarkerOverlapLayout() {
  const markers = getVisibleMarkers();
  if (!markers.length) return;

  clearMarkerOffsets(markers);

  const thresholdX = state.subregionMarkers.length ? 96 : 120;
  const thresholdY = state.subregionMarkers.length ? 42 : 54;
  const positioned = markers
    .map(marker => ({
      marker,
      point: map.latLngToLayerPoint(marker.getLatLng())
    }))
    .sort((a, b) => a.point.y - b.point.y);

  const visited = new Set();
  let clusterIndex = 0;

  positioned.forEach((entry, index) => {
    if (visited.has(index)) return;

    const cluster = [entry];
    visited.add(index);

    for (let i = index + 1; i < positioned.length; i += 1) {
      if (visited.has(i)) continue;

      const candidate = positioned[i];
      const closeToCluster = cluster.some(item =>
        Math.abs(item.point.x - candidate.point.x) < thresholdX &&
        Math.abs(item.point.y - candidate.point.y) < thresholdY
      );

      if (closeToCluster) {
        cluster.push(candidate);
        visited.add(i);
      }
    }

    if (cluster.length === 1) return;

    const angleStep = (Math.PI * 2) / cluster.length;
    const radius = Math.min(42, 16 + cluster.length * 5);

    cluster.forEach((item, itemIndex) => {
      const angle = (clusterIndex * 0.55) + (itemIndex * angleStep) - (Math.PI / 2);
      const offsetX = Math.round(Math.cos(angle) * radius);
      const offsetY = Math.round(Math.sin(angle) * radius * 0.72);
      const element = item.marker.getElement();
      if (!element) return;
      element.style.setProperty("--marker-shift-x", `${offsetX}px`);
      element.style.setProperty("--marker-shift-y", `${offsetY}px`);
      element.style.zIndex = String(500 + itemIndex);
    });

    clusterIndex += 1;
  });
}

function scheduleMarkerOverlapLayout(delay = 80) {
  if (markerLayoutTimer) {
    window.clearTimeout(markerLayoutTimer);
  }

  markerLayoutTimer = window.setTimeout(() => {
    applyMarkerOverlapLayout();
    markerLayoutTimer = null;
  }, delay);
}

function restoreCountryMarkers() {
  clearRegionBoundaryLayer();
  clearSubregionBoundaryLayer();
  clearModeratingFactorLayer();
  clearSubregionMarkers();
  clearRegionMarkers();

  Object.keys(state.markers).forEach(key => {
    const marker = state.markers[key];
    const countryMeta = state.countriesData?.[key];
    const categories = countryMeta?.categories || [countryMeta?.category].filter(Boolean);
    const shouldShow = state.currentFilter === "all" || categories.includes(state.currentFilter);

    if (shouldShow) {
      map.addLayer(marker);
    } else if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  scheduleMarkerOverlapLayout();
}

function getSubregionCoords(countryKey, regionKey, subregionKey) {
  return state.subregionCoords?.[countryKey]?.[regionKey]?.[subregionKey] || null;
}

function getRegionBoundaryPolygons(countryKey, regionKey) {
  return state.regionBoundaries?.[countryKey]?.[regionKey] || null;
}

function getSubregionBoundaryPolygons(countryKey, regionKey, subregionKey) {
  return state.subregionBoundaries?.[countryKey]?.[regionKey]?.[subregionKey] || null;
}

function getPolygonBoundsCenter(polygons) {
  if (!Array.isArray(polygons) || !polygons.length) return null;

  const bounds = L.latLngBounds([]);
  polygons.forEach(ring => {
    if (!Array.isArray(ring)) return;
    ring.forEach(point => {
      if (Array.isArray(point) && point.length === 2) {
        bounds.extend(point);
      }
    });
  });

  return bounds.isValid() ? bounds.getCenter() : null;
}

function getPolygonsBounds(polygons) {
  if (!Array.isArray(polygons) || !polygons.length) return null;

  const bounds = L.latLngBounds([]);
  polygons.forEach(ring => {
    if (!Array.isArray(ring)) return;
    ring.forEach(point => {
      if (Array.isArray(point) && point.length === 2) {
        bounds.extend(point);
      }
    });
  });

  return bounds.isValid() ? bounds : null;
}

function getCountryScopeBounds(countryKey) {
  const regionCoords = Object.values(state.regionCoords?.[countryKey] || {})
    .filter(value => Array.isArray(value) && value.length === 2);

  if (!regionCoords.length) {
    const countryCoords = state.countriesData?.[countryKey]?.coords;
    if (Array.isArray(countryCoords) && countryCoords.length === 2) {
      const [lat, lng] = countryCoords;
      return L.latLngBounds([[lat - 1.6, lng - 2.2], [lat + 1.6, lng + 2.2]]);
    }

    return null;
  }

  return L.latLngBounds(regionCoords);
}

function getSelectionBounds(countryKey, regionKey = null, subregionKey = null) {
  if (subregionKey && regionKey) {
    const subregionPolygons = getSubregionBoundaryPolygons(countryKey, regionKey, subregionKey);
    const subregionBounds = getPolygonsBounds(subregionPolygons);
    if (subregionBounds) return subregionBounds;

    const subregionCoords = getSubregionCoords(countryKey, regionKey, subregionKey);
    if (Array.isArray(subregionCoords) && subregionCoords.length === 2) {
      const [lat, lng] = subregionCoords;
      return L.latLngBounds([[lat - 0.28, lng - 0.32], [lat + 0.28, lng + 0.32]]);
    }
  }

  if (regionKey) {
    const regionPolygons = getRegionBoundaryPolygons(countryKey, regionKey);
    const regionBounds = getPolygonsBounds(regionPolygons);
    if (regionBounds) return regionBounds;

    const regionCoords = getRegionCoords(countryKey, regionKey);
    if (Array.isArray(regionCoords) && regionCoords.length === 2) {
      const [lat, lng] = regionCoords;
      return L.latLngBounds([[lat - 0.7, lng - 0.9], [lat + 0.7, lng + 0.9]]);
    }
  }

  return getCountryScopeBounds(countryKey);
}

function getFactorEntriesForScope(countryKey, regionKey = null, subregionKey = null) {
  const factorData = state.moderatingFactors || {};
  const countryEntries = factorData.countries?.[countryKey] || [];
  const regionEntries = regionKey ? (factorData.regions?.[countryKey]?.[regionKey] || []) : [];
  const subregionEntries = (regionKey && subregionKey)
    ? (factorData.subregions?.[countryKey]?.[regionKey]?.[subregionKey] || [])
    : [];

  if (subregionEntries.length) {
    return [...countryEntries, ...regionEntries, ...subregionEntries];
  }

  if (regionEntries.length) {
    return [...countryEntries, ...regionEntries];
  }

  if (regionKey || subregionKey) {
    return [];
  }

  return countryEntries;
}

function toTitleCase(text) {
  return String(text || "")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function inferCoastRoute(countryKey, regionKey, term) {
  const text = `${countryKey} ${regionKey} ${term}`.toLowerCase();

  if (/mediterranean|southern ocean|bass strait|false bay|walker bay|tasmania/.test(text)) {
    return "coast-south";
  }

  if (/adriatic|aegean|ionian|pacific influence|hawkes|hunter|valencia|penedes|marche|puglia|greece/.test(text)) {
    return "coast-east";
  }

  return "coast-west";
}

function inferMountainRoute(countryKey, regionKey, term) {
  const text = `${countryKey} ${regionKey} ${term}`.toLowerCase();

  if (/andes|alpine|alps|vosges|rain shadow|cascades|haardt/.test(text)) {
    return /argentina/.test(text) ? "mountain-west" : "mountain-east";
  }

  if (/adelaide|barossa|wachau|franken|piemonte/.test(text)) {
    return "mountain-north";
  }

  return "mountain-west";
}

function buildFallbackFactorEntries(countryKey, regionKey, fallbackFactors = []) {
  const normalized = Array.isArray(fallbackFactors)
    ? fallbackFactors.map(item => String(item).trim()).filter(Boolean)
    : [];

  const entries = [];

  normalized.forEach(term => {
    if (entries.length >= 2) return;
    const lower = term.toLowerCase();
    let route = null;

    if (/atlantic|pacific|ocean|sea|coastal|maritime|benguela|humboldt|fog/.test(lower)) {
      route = inferCoastRoute(countryKey, regionKey, term);
    } else if (/river|gironde|estuary|douro|loire|danube|rhine|mosel|marne|bodrog|tisza|duero/.test(lower)) {
      route = /diagonal|mosel|bodrog|tisza/.test(lower) ? "river-diagonal-up" : "river-horizontal";
    } else if (/lake/.test(lower)) {
      route = /neusiedl/.test(lower) ? "lake-east" : "lake-west";
    } else if (/mountain|altitude|alpine|andes|vosges|rain shadow|slope|terraces/.test(lower)) {
      route = inferMountainRoute(countryKey, regionKey, term);
    } else if (/wind|mistral|breezes|cloud cover/.test(lower)) {
      route = "wind-west-east";
    }

    if (!route) return;

    entries.push({
      name: toTitleCase(term),
      route,
      description: `${toTitleCase(term)} is an important moderating factor affecting ripening conditions, freshness, and viticulture in this area.`
    });
  });

  return entries;
}

function buildFactorLinePoints(bounds, route = "river-horizontal") {
  if (!bounds?.isValid?.()) return [];

  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const center = bounds.getCenter();
  const latSpan = Math.max(0.18, north - south);
  const lngSpan = Math.max(0.18, east - west);
  const edgeLat = latSpan * 0.16;
  const edgeLng = lngSpan * 0.16;

  switch (route) {
    case "current-west":
    case "coast-west":
      return [
        [south - edgeLat * 0.1, west - edgeLng * 0.45],
        [center.lat, west - edgeLng * 0.2],
        [north + edgeLat * 0.1, west - edgeLng * 0.45]
      ];
    case "current-east":
    case "coast-east":
      return [
        [south - edgeLat * 0.1, east + edgeLng * 0.45],
        [center.lat, east + edgeLng * 0.2],
        [north + edgeLat * 0.1, east + edgeLng * 0.45]
      ];
    case "current-south":
    case "coast-south":
      return [
        [south - edgeLat * 0.38, west + lngSpan * 0.12],
        [south - edgeLat * 0.12, center.lng],
        [south - edgeLat * 0.38, east - lngSpan * 0.12]
      ];
    case "river-vertical":
      return [
        [south, center.lng - edgeLng * 0.08],
        [center.lat, center.lng],
        [north, center.lng + edgeLng * 0.08]
      ];
    case "river-diagonal-up":
      return [
        [south + edgeLat * 0.3, west + lngSpan * 0.12],
        [center.lat, center.lng],
        [north - edgeLat * 0.3, east - lngSpan * 0.12]
      ];
    case "river-diagonal-down":
      return [
        [north - edgeLat * 0.3, west + lngSpan * 0.12],
        [center.lat, center.lng],
        [south + edgeLat * 0.3, east - lngSpan * 0.12]
      ];
    case "mountain-west":
      return [
        [south - edgeLat * 0.05, west + edgeLng * 0.08],
        [center.lat, west + edgeLng * 0.15],
        [north + edgeLat * 0.05, west + edgeLng * 0.08]
      ];
    case "mountain-east":
      return [
        [south - edgeLat * 0.05, east - edgeLng * 0.08],
        [center.lat, east - edgeLng * 0.15],
        [north + edgeLat * 0.05, east - edgeLng * 0.08]
      ];
    case "mountain-north":
      return [
        [north - edgeLat * 0.12, west + lngSpan * 0.1],
        [north - edgeLat * 0.04, center.lng],
        [north - edgeLat * 0.12, east - lngSpan * 0.1]
      ];
    case "mountain-south":
      return [
        [south + edgeLat * 0.12, west + lngSpan * 0.1],
        [south + edgeLat * 0.04, center.lng],
        [south + edgeLat * 0.12, east - lngSpan * 0.1]
      ];
    case "lake-east":
      return [
        [center.lat + latSpan * 0.18, east - edgeLng * 0.3],
        [center.lat, east - edgeLng * 0.06],
        [center.lat - latSpan * 0.18, east - edgeLng * 0.3]
      ];
    case "lake-west":
      return [
        [center.lat + latSpan * 0.18, west + edgeLng * 0.3],
        [center.lat, west + edgeLng * 0.06],
        [center.lat - latSpan * 0.18, west + edgeLng * 0.3]
      ];
    case "wind-west-east":
      return [
        [center.lat + edgeLat * 0.24, west + lngSpan * 0.08],
        [center.lat, center.lng],
        [center.lat - edgeLat * 0.24, east - lngSpan * 0.08]
      ];
    case "wind-north-south":
      return [
        [north - edgeLat * 0.08, center.lng - edgeLng * 0.2],
        [center.lat, center.lng],
        [south + edgeLat * 0.08, center.lng + edgeLng * 0.2]
      ];
    default:
      return [
        [center.lat, west],
        [center.lat, center.lng],
        [center.lat, east]
      ];
  }
}

function showModeratingFactors(countryKey, regionKey = null, subregionKey = null, fallbackFactors = []) {
  clearModeratingFactorLayer();

  const bounds = getSelectionBounds(countryKey, regionKey, subregionKey);
  const curatedEntries = getFactorEntriesForScope(countryKey, regionKey, subregionKey);
  const entries = curatedEntries.length
    ? curatedEntries
    : buildFallbackFactorEntries(countryKey, regionKey, fallbackFactors);

  if (!bounds?.isValid?.() || !entries.length) {
    return false;
  }

  const layerGroup = L.layerGroup();

  entries.forEach(entry => {
    const points = buildFactorLinePoints(bounds, entry.route);
    if (!points.length) return;

    const line = L.polyline(points, {
      color: "#2f86c5",
      weight: 4,
      opacity: 0.8,
      dashArray: entry.route?.startsWith("wind-") ? "8 8" : "10 6"
    });

    const tooltipText = `<b>${entry.name}</b><br>${entry.description}`;
    line.bindTooltip(tooltipText, {
      sticky: true,
      opacity: 0.95,
      className: "factor-tooltip"
    });

    line.addTo(layerGroup);
  });

  if (!layerGroup.getLayers().length) {
    return false;
  }

  layerGroup.addTo(map);
  state.moderatingFactorLayer = layerGroup;
  return true;
}

function getModeratingFactorNotes(countryKey, regionKey = null, subregionKey = null, fallbackFactors = []) {
  const curatedNotes = getFactorEntriesForScope(countryKey, regionKey, subregionKey)
    .map(entry => `${entry.name}: ${entry.description}`);

  const normalizedFallback = Array.isArray(fallbackFactors)
    ? fallbackFactors.map(item => String(item).trim()).filter(Boolean)
    : [];

  return curatedNotes.length ? curatedNotes : normalizedFallback;
}

function getSubregionEntries(countryKey, regionKey, region) {
  const entries = Object.entries(region?.subregions || {});

  if (state.currentFilter === "all") {
    return entries;
  }

  return entries.filter(([subregionKey]) =>
    getRegionCategories(countryKey, subregionKey).has(state.currentFilter) ||
    getRegionCategories(countryKey, regionKey).has(state.currentFilter)
  );
}

function getVisibleMapFitPadding() {
  const toolbar = byId("topToolbar");
  const mapElement = byId("map");

  if (!toolbar || !sheet || !mapElement) {
    return {
      paddingTopLeft: [50, 50],
      paddingBottomRight: [50, 50]
    };
  }

  const toolbarRect = toolbar.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  const mapRect = mapElement.getBoundingClientRect();

  const topInset = Math.max(32, Math.round(toolbarRect.bottom - mapRect.top + 20));
  const bottomInset = Math.max(32, Math.round(mapRect.bottom - sheetRect.top + 20));

  return {
    paddingTopLeft: [60, topInset],
    paddingBottomRight: [60, bottomInset]
  };
}

function focusMapOnSubregionMarkers(countryKey, regionKey) {
  const coords = Object.entries(state.subregionCoords?.[countryKey]?.[regionKey] || {})
    .map(([, value]) => value)
    .filter(value => Array.isArray(value) && value.length === 2);

  if (!coords.length) return;

  if (coords.length === 1) {
    centerMapOnSelection(coords[0], 7);
    return;
  }

  const { paddingTopLeft, paddingBottomRight } = getVisibleMapFitPadding();
  map.flyToBounds(coords, {
    paddingTopLeft,
    paddingBottomRight,
    maxZoom: 7
  });
}

function focusMapOnLayerBounds(layer, maxZoom = 8) {
  if (!layer) return false;

  const bounds = layer.getBounds?.();
  if (!bounds || !bounds.isValid()) return false;

  const { paddingTopLeft, paddingBottomRight } = getVisibleMapFitPadding();
  map.flyToBounds(bounds, {
    paddingTopLeft,
    paddingBottomRight,
    maxZoom
  });
  return true;
}

function showSubregionBoundaryOverlay(countryKey, regionKey, subregionKey) {
  clearSubregionBoundaryLayer();

  const polygons = getSubregionBoundaryPolygons(countryKey, regionKey, subregionKey);
  if (!Array.isArray(polygons) || !polygons.length) {
    return false;
  }

  const boundaryLayer = L.polygon(polygons, {
    color: "#8f2648",
    weight: 2,
    opacity: 0.92,
    fillColor: "#b63a64",
    fillOpacity: 0.18,
    interactive: false
  }).addTo(map);

  state.subregionBoundaryLayer = boundaryLayer;
  return true;
}

function showRegionBoundaryOverlay(countryKey, regionKey) {
  clearRegionBoundaryLayer();

  const polygons = getRegionBoundaryPolygons(countryKey, regionKey);
  if (!Array.isArray(polygons) || !polygons.length) {
    return false;
  }

  const boundaryLayer = L.polygon(polygons, {
    color: "#7b1e3a",
    weight: 2,
    opacity: 0.8,
    fillColor: "#b8893c",
    fillOpacity: 0.12,
    interactive: false
  }).addTo(map);

  state.regionBoundaryLayer = boundaryLayer;
  return true;
}

function showSelectedSubregionMarker(countryKey, regionKey, subregionKey, subregion) {
  clearRegionBoundaryLayer();
  clearSubregionBoundaryLayer();
  clearModeratingFactorLayer();
  clearSubregionMarkers();
  clearRegionMarkers();
  hideAllCountryMarkers();

  const polygons = getSubregionBoundaryPolygons(countryKey, regionKey, subregionKey);
  const boundaryCenter = getPolygonBoundsCenter(polygons);
  const coords = boundaryCenter
    ? [boundaryCenter.lat, boundaryCenter.lng]
    : getSubregionCoords(countryKey, regionKey, subregionKey);

  if (!Array.isArray(coords) || coords.length !== 2) return;

  const marker = L.marker(coords, {
    icon: L.divIcon({
      className: "region-map-marker-wrap",
      html: buildMapMarkerButton(subregion.name || subregionKey, {
        markerType: "subregion",
        selected: true
      }),
      iconSize: null
    }),
    keyboard: true,
    title: subregion.name || subregionKey
  });

  marker.on("click", () => showSubregion(countryKey, regionKey, subregionKey));
  marker.addTo(map);
  state.subregionMarkers.push(marker);

  scheduleMarkerOverlapLayout();
  if (showSubregionBoundaryOverlay(countryKey, regionKey, subregionKey)) {
    focusMapOnLayerBounds(state.subregionBoundaryLayer, 8);
  } else {
    centerMapOnSelection(coords, 8);
  }
}

function showSubregionMarkers(countryKey, regionKey, region) {
  clearSubregionBoundaryLayer();
  clearModeratingFactorLayer();
  clearSubregionMarkers();
  clearRegionMarkers();

  const subregionCoords = state.subregionCoords?.[countryKey]?.[regionKey] || {};
  const subregionEntries = getSubregionEntries(countryKey, regionKey, region);

  subregionEntries.forEach(([subregionKey, subregion]) => {
    const coords = subregionCoords[subregionKey];
    if (!Array.isArray(coords) || coords.length !== 2) return;

    const marker = L.marker(coords, {
      icon: L.divIcon({
        className: "region-map-marker-wrap",
        html: buildMapMarkerButton(subregion.name || subregionKey, {
          markerType: "subregion"
        }),
        iconSize: null
      }),
      keyboard: true,
      title: subregion.name || subregionKey
    });

    marker.on("click", () => showSubregion(countryKey, regionKey, subregionKey));
    marker.addTo(map);
    state.subregionMarkers.push(marker);
  });

  scheduleMarkerOverlapLayout();
  focusMapOnSubregionMarkers(countryKey, regionKey);
}

function getRegionCoords(countryKey, regionKey) {
  return state.regionCoords?.[countryKey]?.[regionKey] || null;
}

function focusMapOnRegionMarkers(countryKey) {
  const coords = Object.entries(state.regionCoords?.[countryKey] || {})
    .map(([, value]) => value)
    .filter(value => Array.isArray(value) && value.length === 2);

  if (!coords.length) return;

  if (coords.length === 1) {
    centerMapOnSelection(coords[0], 7);
    return;
  }

  const { paddingTopLeft, paddingBottomRight } = getVisibleMapFitPadding();
  map.flyToBounds(coords, {
    paddingTopLeft,
    paddingBottomRight,
    maxZoom: 7
  });
}

function centerMapOnSelection(coords, fallbackZoom = 7) {
  if (!Array.isArray(coords) || coords.length !== 2) return;

  if (mapCenterTimer) {
    window.clearTimeout(mapCenterTimer);
  }

  mapCenterTimer = window.setTimeout(() => {
    const markerCount = Math.max(state.regionMarkers.length, state.subregionMarkers.length);
    const toolbar = byId("topToolbar");
    const mapElement = byId("map");
    const targetZoom = markerCount > 1
      ? Math.max(2, map.getZoom() - 1)
      : fallbackZoom;

    const moveSelectionIntoVisibleBand = () => {
      if (!toolbar || !sheet || !mapElement) return;

      const toolbarRect = toolbar.getBoundingClientRect();
      const sheetRect = sheet.getBoundingClientRect();
      const mapRect = mapElement.getBoundingClientRect();

      const visibleTop = Math.max(mapRect.top + 16, toolbarRect.bottom + 16);
      const visibleBottom = Math.min(mapRect.bottom - 16, sheetRect.top - 16);
      const visibleCenterY = visibleBottom > visibleTop
        ? (visibleTop + visibleBottom) / 2
        : mapRect.top + mapRect.height / 2;

      const desiredPoint = L.point(
        mapRect.width / 2,
        Math.max(24, Math.min(mapRect.height - 24, visibleCenterY - mapRect.top))
      );

      const projectedTarget = map.project(coords, map.getZoom());
      const centeredTarget = projectedTarget.subtract(
        desiredPoint.subtract(map.getSize().divideBy(2))
      );
      const adjustedCenter = map.unproject(centeredTarget, map.getZoom());

      map.panTo(adjustedCenter, { animate: true, duration: 0.35 });
    };

    map.flyTo(coords, targetZoom, { duration: 0.45 });
    window.setTimeout(moveSelectionIntoVisibleBand, 320);

    mapCenterTimer = null;
  }, 280);
}

function showRegionMarkers(countryKey, country) {
  clearRegionBoundaryLayer();
  clearSubregionBoundaryLayer();
  clearModeratingFactorLayer();
  clearSubregionMarkers();
  clearRegionMarkers();
  hideAllCountryMarkers();

  const regionCoords = state.regionCoords?.[countryKey] || {};
  const regionEntries = getVisibleRegionEntries(countryKey, country);

  regionEntries.forEach(([regionKey, region]) => {
    const coords = regionCoords[regionKey];
    if (!Array.isArray(coords) || coords.length !== 2) return;

    const marker = L.marker(coords, {
      icon: L.divIcon({
        className: "region-map-marker-wrap",
        html: buildMapMarkerButton(region.name || regionKey, {
          markerType: "region"
        }),
        iconSize: null
      }),
      keyboard: true,
      title: region.name || regionKey
    });

    marker.on("click", () => showRegion(countryKey, regionKey));
    marker.addTo(map);
    state.regionMarkers.push(marker);
  });

  state.activeCountryKey = countryKey;
  scheduleMarkerOverlapLayout();
  focusMapOnRegionMarkers(countryKey);
}

// ================= INIT =================
async function init() {
  showLoading("Loading Wine Atlas...");
  state.countriesData = await loadJson("./data/countries.json");
  state.moderatingFactors = await loadJson("./data/moderating-factors.json");
  state.regionCoords = await loadJson("./data/region-coords.json");
  state.regionBoundaries = await loadJson("./data/region-boundaries.json");
  state.subregionCoords = await loadJson("./data/subregion-coords.json");
  state.subregionBoundaries = await loadJson("./data/subregion-boundaries.json");
  state.quizQuestions = [];

  Object.keys(state.countriesData).forEach(key => {
    const c = state.countriesData[key];
    if (!c.coords) return;

    const marker = L.marker(c.coords, {
      icon: L.divIcon({
        className: "country-map-marker-wrap",
        html: buildMapMarkerButton(c.name || key, {
          markerType: "country"
        }),
        iconSize: null
      }),
      keyboard: true,
      title: c.name || key
    }).addTo(map);
    marker.on("click", () => showCountry(key));
    state.markers[key] = marker;
  });

  scheduleMarkerOverlapLayout(140);

  byId("searchInput").addEventListener("input", debounce(function (e) {
    searchAll(e.target.value);
  }, 250));

  byId("quizBtn").addEventListener("click", () => showQuizModes());
  byId("favoritesBtn").addEventListener("click", () => showFavorites());
  byId("progressBtn").addEventListener("click", () => showProgress());
  byId("recentBtn").addEventListener("click", () => showRecent());

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(btn.dataset.filter);
    });
  });

  state.quizQuestions = await loadJson("./data/quiz.json");

  buildGeneratedQuestions().catch(err => {
    console.error("Question generation failed:", err);
  });

  renderHomePanel();
  const toolbar = byId("topToolbar");
  const toolbarToggle = byId("toolbarToggle");

  if (toolbar && toolbarToggle) {
    toolbarToggle.addEventListener("click", () => {
      toolbar.classList.toggle("expanded");
      toolbarToggle.textContent = toolbar.classList.contains("expanded")
        ? "Filters ▴"
        : "Filters ▾";

      setTimeout(() => {
        updateSheetMetrics();
        applySheetState(currentSheetState);
      }, 30);
    });
  }
  updateSheetMetrics();
  window.addEventListener("resize", () => {
    updateSheetMetrics();
    applySheetState(currentSheetState);
  });

  window.addEventListener("orientationchange", () => {
    updateSheetMetrics();
    applySheetState(currentSheetState);
  });
}

init();

map.on("zoomend moveend", () => {
  scheduleMarkerOverlapLayout(40);
});

// ================= COUNTRY =================
async function showCountry(countryKey) {
  showLoading("Loading country...");
  openSheetMid();
  try {
    const countryMeta = state.countriesData[countryKey];
    if (!countryMeta) return;

    const country = await loadJson(`./data/${countryMeta.file}`);
    if (!country || typeof country !== "object") return;

    setPanelTitle(country.name || countryKey);
    setBreadcrumb([{ label: country.name || countryKey }]);

    showRegionMarkers(countryKey, country);
    showModeratingFactors(countryKey);

    let html = `
      <div class="section-card">
        <button class="btn secondary" id="backToCountriesBtn">← All Countries</button>
        <p><b>Country:</b> ${country.name}</p>
        <p>Select a ${state.currentFilter === "all" ? "" : `${state.currentFilter} `}region to view its details.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
    `;

    const visibleRegionEntries = getVisibleRegionEntries(countryKey, country);
    if (visibleRegionEntries.length) {
      html += visibleRegionEntries.map(([regionKey, region]) => {
        const label = region?.name || regionKey;
        return `
          <button class="pill" data-region="${regionKey}">
            ${label}
          </button>
        `;
      }).join("");
    } else {
      html += `<p>No ${state.currentFilter === "all" ? "" : state.currentFilter} regions available.</p>`;
    }

    html += `
        </div>
      </div>
    `;

    byId("content").innerHTML = html;

    const backBtn = byId("backToCountriesBtn");
    if (backBtn) {
      backBtn.onclick = () => {
        restoreCountryMarkers();
        map.setView([25, 10], 2);
        renderHomePanel();
      };
    }

    document.querySelectorAll("[data-region]").forEach(btn => {
      btn.addEventListener("click", () => showRegion(countryKey, btn.dataset.region));
    });
    bindPronounceButtons();
  } catch (err) {
    console.error("showCountry failed:", err);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>Failed to load country details.</p>
      </div>
    `;
  }
}

// ================= REGION =================
async function showRegion(countryKey, regionKey) {
  showLoading("Loading region...");
  openSheetMid();
  try {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);
    const region = country.regions?.[regionKey];
    if (!region) return;

    const subregionEntries = getSubregionEntries(countryKey, regionKey, region);

    if (subregionEntries.length) {
      showSubregionMarkers(countryKey, regionKey, region);
      showRegionBoundaryOverlay(countryKey, regionKey);
    } else {
      showRegionMarkers(countryKey, country);

      const regionCoords = getRegionCoords(countryKey, regionKey);
      if (showRegionBoundaryOverlay(countryKey, regionKey)) {
        focusMapOnLayerBounds(state.regionBoundaryLayer, 7);
      } else if (regionCoords) {
        centerMapOnSelection(regionCoords, 7);
      } else if (countryMeta.coords && countryMeta.zoom) {
        map.flyTo(countryMeta.coords, countryMeta.zoom);
      }
    }

    showModeratingFactors(countryKey, regionKey, null, region.mitigating);

    setPanelTitle(region.name || regionKey);
    setBreadcrumb([
      { label: country.name || countryKey, click: () => showCountry(countryKey) },
      { label: region.name || regionKey }
    ]);

    const pageKey = `region::${country.name}::${region.name || regionKey}`;
    const moderatingNotes = getModeratingFactorNotes(
      countryKey,
      regionKey,
      null,
      region.mitigating
    );

    let html = `
      <div class="section-card">
        <button class="btn secondary" id="backToCountry">← Back</button>
        <button class="btn secondary" id="quizThisRegionBtn">🧠 Quiz This Region</button>
        ${renderStudyButtons(pageKey)}

        <p><b>Region:</b> ${region.name || regionKey}</p>
        ${region.summary ? `<p><b>Summary:</b> ${region.summary}</p>` : ""}
        <p><b>Climate:</b> ${region.climate || "-"}</p>
        ${moderatingNotes.length ? `<p><b>Moderating Factors:</b> ${moderatingNotes.join(" • ")}</p>` : ""}
        <p><b>Style:</b> ${region.styleSummary || "-"}</p>
        ${renderStudyList("Vineyard Factors", region.vineyardFactors)}
        ${renderStudyList("Human Factors", region.humanFactors)}
        ${region.classification ? `<p><b>Classification:</b> ${region.classification}</p>` : ""}
        ${region.lawNotes?.length ? `<p><b>Law / Exam Notes:</b> ${region.lawNotes.join(" ")}</p>` : ""}
        ${region.keyGrapes?.length ? `<p><b>Key Grapes:</b> ${region.keyGrapes.join(", ")}</p>` : ""}
        ${subregionEntries.length ? `<p><b>Sub-regions:</b></p>` : ""}
        ${subregionEntries.length ? subregionEntries.map(([subregionKey, subregion]) => `
          <button class="pill" data-subregion="${subregionKey}">
            ${subregion.name || subregionKey}
          </button>
        `).join("") : ""}
        ${subregionEntries.length ? `<p style="margin-top:14px;"><b>Grapes:</b></p>` : `<p><b>Grapes:</b></p>`}
`;

    const grapeKeys = Object.keys(region.grapes || {});
    if (grapeKeys.length) {
      html += grapeKeys.map(grapeKey => `
        <button class="pill" data-grape="${grapeKey}">
          ${grapeKey}
        </button>
      `).join("");
    } else {
      html += `<p>No grapes available.</p>`;
    }

    html += `</div>`;

    if (region.styles && Object.keys(region.styles).length) {
      html += `
        <div class="section-card">
          <p><b>Styles:</b></p>
          ${Object.keys(region.styles).map(styleKey => {
            const style = region.styles?.[styleKey];
            const label = style?.name || styleKey;
            return `
              <button class="btn" data-style="${styleKey}">
                ${label}
              </button>
            `;
          }).join("")}
        </div>
      `;
    if (region.examTips?.length) {
      html += `
        <div class="section-card">
          <p class="section-title">Exam Tips</p>
          <ul>${region.examTips.map(x => `<li>${x}</li>`).join("")}</ul>
        </div>
      `;
    }

    if (region.tags?.length) {
      html += `
        <div class="section-card">
          <p class="section-title">Tags</p>
          <div>${region.tags.map(x => `<span class="pill">${x}</span>`).join("")}</div>
        </div>
      `;
    }
    }

    byId("content").innerHTML = html;

    bindStudyButtons(pageKey, () => showRegion(countryKey, regionKey));

    byId("backToCountry").onclick = () => showCountry(countryKey);

    document.querySelectorAll("[data-subregion]").forEach(btn => {
      btn.addEventListener("click", () => showSubregion(countryKey, regionKey, btn.dataset.subregion));
    });

    document.querySelectorAll("[data-grape]").forEach(btn => {
      btn.addEventListener("click", () => showGrape(countryKey, regionKey, btn.dataset.grape));
    });

    document.querySelectorAll("[data-style]").forEach(btn => {
      btn.addEventListener("click", () => showStyle(countryKey, btn.dataset.style, regionKey));
    });
    bindPronounceButtons();

    byId("quizThisRegionBtn").onclick = async () => {
      const questions = await buildQuizForRegion(
        regionKey,
        region,
        country.name
      );

      startCustomQuiz(questions, `Quiz: ${region.name}`);
    };
  } catch (err) {
    console.error("showRegion failed:", err);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>Failed to load region details.</p>
      </div>
    `;
  }
}

async function showSubregion(countryKey, regionKey, subregionKey) {
  showLoading("Loading sub-region...");
  openSheetMid();
  try {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);
    const region = country.regions?.[regionKey];
    const subregion = region?.subregions?.[subregionKey];
    if (!region || !subregion) return;

    showSelectedSubregionMarker(countryKey, regionKey, subregionKey, subregion);
    showModeratingFactors(countryKey, regionKey, subregionKey, subregion.mitigating || region.mitigating);

    setPanelTitle(subregion.name || subregionKey);
    setBreadcrumb([
      { label: country.name || countryKey, click: () => showCountry(countryKey) },
      { label: region.name || regionKey, click: () => showRegion(countryKey, regionKey) },
      { label: subregion.name || subregionKey }
    ]);

    const subregionGrapeEntries = Object.entries(subregion.grapes || {});
    const derivedGrapeKeys = subregionGrapeEntries.length
      ? subregionGrapeEntries.map(([grapeKey]) => grapeKey)
      : (subregion.keyGrapes || []).filter(grapeKey => region.grapes?.[grapeKey]);
    const moderatingNotes = getModeratingFactorNotes(
      countryKey,
      regionKey,
      subregionKey,
      subregion.mitigating || region.mitigating
    );

    let html = `
      <div class="section-card">
        <button class="btn secondary" id="backToRegion">← Back</button>
        <p><b>Sub-region:</b> ${subregion.name || subregionKey}</p>
        ${subregion.summary ? `<p><b>Summary:</b> ${subregion.summary}</p>` : ""}
        <p><b>Climate:</b> ${subregion.climate || region.climate || "-"}</p>
        ${moderatingNotes.length ? `<p><b>Moderating Factors:</b> ${moderatingNotes.join(" • ")}</p>` : ""}
        <p><b>Style:</b> ${subregion.styleSummary || "-"}</p>
        ${renderStudyList("Vineyard Factors", subregion.vineyardFactors)}
        ${renderStudyList("Human Factors", subregion.humanFactors)}
        ${subregion.classification ? `<p><b>Classification:</b> ${subregion.classification}</p>` : ""}
        ${subregion.lawNotes?.length ? `<p><b>Law / Exam Notes:</b> ${subregion.lawNotes.join(" ")}</p>` : ""}
        ${subregion.keyGrapes?.length ? `<p><b>Key Grapes:</b> ${subregion.keyGrapes.join(", ")}</p>` : ""}
        ${derivedGrapeKeys.length ? `<p><b>Grapes:</b></p>
        ${derivedGrapeKeys.map(grapeKey => `
          <button class="pill" data-subregion-grape="${grapeKey}">
            ${grapeKey}
          </button>
        `).join("")}` : ""}
      </div>
    `;

    if (subregion.examTips?.length) {
      html += `
        <div class="section-card">
          <p class="section-title">Exam Tips</p>
          <ul>${subregion.examTips.map(x => `<li>${x}</li>`).join("")}</ul>
        </div>
      `;
    }

    if (subregion.tags?.length) {
      html += `
        <div class="section-card">
          <p class="section-title">Tags</p>
          <div>${subregion.tags.map(x => `<span class="pill">${x}</span>`).join("")}</div>
        </div>
      `;
    }

    byId("content").innerHTML = html;

    byId("backToRegion").onclick = () => showRegion(countryKey, regionKey);

    document.querySelectorAll("[data-subregion-grape]").forEach(btn => {
      btn.addEventListener("click", () => showGrape(countryKey, regionKey, btn.dataset.subregionGrape, subregionKey));
    });

    bindPronounceButtons();
  } catch (err) {
    console.error("showSubregion failed:", err);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>Failed to load sub-region details.</p>
      </div>
    `;
  }
}

// ================= GRAPE =================
async function showGrape(countryKey, regionKey, grapeKey, subregionKey = null) {
  showLoading("Loading grape profile...");
  openSheetFull();

  const countryMeta = state.countriesData[countryKey];
  const country = await loadJson(`./data/${countryMeta.file}`);
  const region = country.regions[regionKey];
  const subregion = subregionKey ? region?.subregions?.[subregionKey] : null;
  const grape = subregion?.grapes?.[grapeKey] || region?.grapes?.[grapeKey];
  if (!grape) return;

  if (subregionKey && subregion) {
    showSelectedSubregionMarker(countryKey, regionKey, subregionKey, subregion);
    showModeratingFactors(countryKey, regionKey, subregionKey, subregion.mitigating || region.mitigating);
  } else {
    showRegionMarkers(countryKey, country);
    const regionCoords = getRegionCoords(countryKey, regionKey);
    if (showRegionBoundaryOverlay(countryKey, regionKey)) {
      focusMapOnLayerBounds(state.regionBoundaryLayer, 8);
    } else if (regionCoords) {
      map.flyTo(regionCoords, 8);
    }
    showModeratingFactors(countryKey, regionKey, null, region.mitigating);
  }

  setPanelTitle(grapeKey);
  const breadcrumb = [
    { label: country.name, click: () => showCountry(countryKey) },
    { label: region.name, click: () => showRegion(countryKey, regionKey) }
  ];

  if (subregionKey && subregion) {
    breadcrumb.push({
      label: subregion.name || subregionKey,
      click: () => showSubregion(countryKey, regionKey, subregionKey)
    });
  }

  breadcrumb.push({ label: grapeKey });
  setBreadcrumb(breadcrumb);

  let profileHtml = "";
  if (grape.profile) {
    profileHtml = `
      <div class="section-card">
        <p class="section-title">Profile Meter</p>
        <div class="meter-group">
          ${renderMeter("Acidity", grape.profile.acidity)}
          ${renderMeter("Body", grape.profile.body)}
          ${renderMeter("Tannin", grape.profile.tannin)}
          ${renderMeter("Alcohol", grape.profile.alcohol)}
        </div>
      </div>
    `;
  }

  let aromaHtml = "";

  if (grape.aromas?.length) {
    aromaHtml = `
      <div class="section-card">
        <p class="section-title">Aromas</p>
        ${renderAromaChips(grape.aromas)}
      </div>
    `;
  }

  const pageKey = subregionKey && subregion
    ? `grape::${country.name}::${region.name}::${subregion.name || subregionKey}::${grapeKey}`
    : `grape::${country.name}::${region.name}::${grapeKey}`;

  byId("content").innerHTML = `
    <div class="section-card">
      <button class="btn secondary" id="backToRegion">← Back</button>
      <button class="btn" id="favBtn">⭐ Favorite</button>
      <button class="btn secondary" id="quizThisGrapeBtn">🧠 Quiz This Grape</button>
      ${renderStudyButtons(pageKey)}
    </div>

    <div class="section-card">
      <p><b>Grape:</b> ${grapeKey}</p>
      <p><b>Style:</b> ${grape.style || "-"}</p>
      ${grape.summary ? `<p><b>Summary:</b> ${grape.summary}</p>` : ""}
      ${grape.aliases?.length ? `<p><b>Aliases:</b> ${grape.aliases.join(", ")}</p>` : ""}

      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Acidity</div>
          <div class="meta-value">${grape.profile?.acidity || "-"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Alcohol</div>
          <div class="meta-value">${grape.profile?.alcohol || "-"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Body</div>
          <div class="meta-value">${grape.profile?.body || "-"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Tannin</div>
          <div class="meta-value">${grape.profile?.tannin || "-"}</div>
        </div>
      </div>
    </div>

    ${profileHtml}
    ${aromaHtml}

    <div class="section-card">
      <p class="section-title">Viticulture</p>
      <ul>${(grape.viticulture || []).map(x => `<li>${x}</li>`).join("")}</ul>
    </div>

    <div class="section-card">
      <p class="section-title">Winemaking</p>
      <ul>${(grape.winemaking || []).map(x => `<li>${x}</li>`).join("")}</ul>
    </div>

    ${grape.pairing?.length ? `
      <div class="section-card">
        <p class="section-title">Food Pairing</p>
        ${renderPairingChips(grape.pairing)}
      </div>
    ` : ""}

    ${grape.examTips?.length ? `
      <div class="section-card">
        <p class="section-title">Exam Tips</p>
        <ul>${grape.examTips.map(x => `<li>${x}</li>`).join("")}</ul>
      </div>
    ` : ""}

    ${grape.tags?.length ? `
      <div class="section-card">
        <p class="section-title">Tags</p>
        <div>${grape.tags.map(x => `<span class="pill">${x}</span>`).join("")}</div>
      </div>
    ` : ""}
  `;

  bindPronounceButtons();

  byId("backToRegion").onclick = () => {
    if (subregionKey && subregion) {
      showSubregion(countryKey, regionKey, subregionKey);
    } else {
      showRegion(countryKey, regionKey);
    }
  };

  byId("favBtn").onclick = () => {
    const item = `${country.name} > ${region.name} > ${grapeKey}`;

    if (!state.favorites.includes(item)) {
      state.favorites.push(item);
      saveFavorites();
      alert("Added to favorites");
    } else {
      alert("Already in favorites");
    }
  };
  
  byId("quizThisGrapeBtn").onclick = async () => {
    const questions = await buildQuizForGrape(
      grapeKey,
      grape,
      region.name,
      country.name
    );

    startCustomQuiz(questions, `Quiz: ${grapeKey}`);
  };

  bindStudyButtons(pageKey, () => showGrape(countryKey, regionKey, grapeKey, subregionKey));

  const item = `${country.name} > ${region.name} > ${grapeKey}`;
  recent = recent.filter(x => x !== item);
  recent.unshift(item);
  recent = recent.slice(0, 10);
  saveRecent();
}

// ================= FAVORITES =================
function showFavorites() {
  showLoading("Loading favorites...");
  restoreCountryMarkers();
  openSheetFull();
  setPanelTitle("Favorites");
  setBreadcrumb([{ label: "Favorites" }]);

  if (!state.favorites.length) {
    byId("content").innerHTML = `<div class="section-card"><p>No favorites yet.</p></div>`;
    return;
  }

  let html = `<div class="section-card"><p><b>Saved Grapes:</b></p>`;

  state.favorites.forEach((item, index) => {
    html += `
      <div class="list-card">
        <div style="cursor:pointer;" data-open-fav="${index}">${item}</div>
        <button class="btn" data-remove-fav="${index}">Remove</button>
      </div>
    `;
  });

  html += `</div>`;
  byId("content").innerHTML = html;

  document.querySelectorAll("[data-remove-fav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeFav);
      state.favorites.splice(index, 1);
      saveFavorites();
      showFavorites();
    });
  });

  document.querySelectorAll("[data-open-fav]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fav = parseFavorite(state.favorites[btn.dataset.openFav]);

      for (const countryKey in state.countriesData) {
        const countryMeta = state.countriesData[countryKey];
        if (countryMeta.name !== fav.country) continue;

        const country = await loadJson(`./data/${countryMeta.file}`);

        for (const regionKey in country.regions) {
          const region = country.regions[regionKey];
          if (region.name !== fav.region) continue;

          await showGrape(countryKey, regionKey, fav.grape);
          return;
        }
      }
    });
  });
}
function showQuizModes() {
  restoreCountryMarkers();
  openSheetFull();

  setPanelTitle("Select Quiz Mode");
  setBreadcrumb([{ label: "Quiz" }]);

  byId("content").innerHTML = `
    <div class="section-card">
      <p class="section-title">Choose Mode</p>

      <button class="btn quiz-mode" data-mode="all">🌍 All</button>
      <button class="btn quiz-mode" data-mode="grapes">🍇 Grapes</button>
      <button class="btn quiz-mode" data-mode="regions">🗺 Regions</button>
      <button class="btn quiz-mode" data-mode="profiles">📊 Profiles</button>
      <button class="btn quiz-mode" data-mode="styles">🍷 Styles</button>
      <button class="btn quiz-mode" data-mode="study">📚 Study Facts</button>
      <button class="btn quiz-mode" data-mode="weak">🔥 Weak Areas</button>
    </div>
  `;

  document.querySelectorAll(".quiz-mode").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      startQuiz(true, mode);
    });
  });
}

// ================= SEARCH =================
async function searchAll(query) {
  restoreCountryMarkers();
  const q = String(query || "").trim().toLowerCase();

  if (!q) {
    renderHomePanel();
    return;
  }

  function match(text) {
    return String(text || "").toLowerCase().includes(q);
  }

  function matchArray(arr) {
    return Array.isArray(arr) && arr.some(item => String(item).toLowerCase().includes(q));
  }

  const results = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];

    // countries.json level
    if (
      match(countryMeta.name) ||
      match(countryMeta.category) ||
      matchArray(countryMeta.categories) ||
      matchArray(countryMeta.tags)
    ) {
      results.push({
        type: "country",
        label: countryMeta.name,
        action: () => showCountry(countryKey)
      });
    }

    // full country file
    const country = await loadJson(`./data/${countryMeta.file}`);

    let countryMatchReasons = [];

    if (match(country.name)) {
      countryMatchReasons.push(`name: ${country.name}`);
    }

    if (match(country.summary)) {
      countryMatchReasons.push(`summary: ${country.summary}`);
    }

    const matchedCountryTags = (country.tags || []).filter(tag =>
      String(tag).toLowerCase().includes(q)
    );
    if (matchedCountryTags.length) {
      countryMatchReasons.push(`tag: ${matchedCountryTags[0]}`);
    }

    const matchedCountryTips = (country.examTips || []).filter(tip =>
      String(tip).toLowerCase().includes(q)
    );
    if (matchedCountryTips.length) {
      countryMatchReasons.push(`exam tip: ${matchedCountryTips[0]}`);
    }

    if (countryMatchReasons.length) {
      results.push({
        type: "country",
        label: `${country.name}`,
        matchReasons: countryMatchReasons,
        action: () => showCountry(countryKey)
      });
}

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      let regionMatchReasons = [];

      if (match(region.name)) {
        regionMatchReasons.push(`name: ${region.name}`);
      }

      if (match(region.summary)) {
        regionMatchReasons.push(`summary: ${region.summary}`);
      }

      if (match(region.climate)) {
        regionMatchReasons.push(`climate: ${region.climate}`);
      }

      if (match(region.styleSummary)) {
        regionMatchReasons.push(`style: ${region.styleSummary}`);
      }

      const matchedRegionKeyGrapes = (region.keyGrapes || []).filter(grape =>
        String(grape).toLowerCase().includes(q)
      );
      if (matchedRegionKeyGrapes.length) {
        regionMatchReasons.push(`key grape: ${matchedRegionKeyGrapes[0]}`);
      }

      const matchedRegionTags = (region.tags || []).filter(tag =>
        String(tag).toLowerCase().includes(q)
      );
      if (matchedRegionTags.length) {
        regionMatchReasons.push(`tag: ${matchedRegionTags[0]}`);
      }

      const matchedRegionTips = (region.examTips || []).filter(tip =>
        String(tip).toLowerCase().includes(q)
      );
      if (matchedRegionTips.length) {
        regionMatchReasons.push(`exam tip: ${matchedRegionTips[0]}`);
      }

      const matchedMitigating = (region.mitigating || []).filter(item =>
        String(item).toLowerCase().includes(q)
      );
      if (matchedMitigating.length) {
        regionMatchReasons.push(`mitigating: ${matchedMitigating[0]}`);
      }

      const matchedVineyardFactors = (region.vineyardFactors || []).filter(item =>
        String(item).toLowerCase().includes(q)
      );
      if (matchedVineyardFactors.length) {
        regionMatchReasons.push(`vineyard factor: ${matchedVineyardFactors[0]}`);
      }

      const matchedHumanFactors = (region.humanFactors || []).filter(item =>
        String(item).toLowerCase().includes(q)
      );
      if (matchedHumanFactors.length) {
        regionMatchReasons.push(`human factor: ${matchedHumanFactors[0]}`);
      }

      if (regionMatchReasons.length) {
        results.push({
          type: "region",
          label: `${region.name} (${country.name})`,
          matchReasons: regionMatchReasons,
          action: () => showRegion(countryKey, regionKey)
        });
}

      for (const subregionKey in (region.subregions || {})) {
        const subregion = region.subregions[subregionKey];
        const subregionMatchReasons = [];

        if (match(subregion.name)) {
          subregionMatchReasons.push(`name: ${subregion.name}`);
        }

        if (match(subregion.summary)) {
          subregionMatchReasons.push(`summary: ${subregion.summary}`);
        }

        if (match(subregion.climate)) {
          subregionMatchReasons.push(`climate: ${subregion.climate}`);
        }

        if (match(subregion.styleSummary)) {
          subregionMatchReasons.push(`style: ${subregion.styleSummary}`);
        }

        const matchedSubregionKeyGrapes = (subregion.keyGrapes || []).filter(grape =>
          String(grape).toLowerCase().includes(q)
        );
        if (matchedSubregionKeyGrapes.length) {
          subregionMatchReasons.push(`key grape: ${matchedSubregionKeyGrapes[0]}`);
        }

        const matchedSubregionTags = (subregion.tags || []).filter(tag =>
          String(tag).toLowerCase().includes(q)
        );
        if (matchedSubregionTags.length) {
          subregionMatchReasons.push(`tag: ${matchedSubregionTags[0]}`);
        }

        const matchedSubregionTips = (subregion.examTips || []).filter(tip =>
          String(tip).toLowerCase().includes(q)
        );
        if (matchedSubregionTips.length) {
          subregionMatchReasons.push(`exam tip: ${matchedSubregionTips[0]}`);
        }

        const matchedSubregionVineyard = (subregion.vineyardFactors || []).filter(item =>
          String(item).toLowerCase().includes(q)
        );
        if (matchedSubregionVineyard.length) {
          subregionMatchReasons.push(`vineyard factor: ${matchedSubregionVineyard[0]}`);
        }

        const matchedSubregionHuman = (subregion.humanFactors || []).filter(item =>
          String(item).toLowerCase().includes(q)
        );
        if (matchedSubregionHuman.length) {
          subregionMatchReasons.push(`human factor: ${matchedSubregionHuman[0]}`);
        }

        if (subregionMatchReasons.length) {
          results.push({
            type: "subregion",
            label: `${subregion.name} (${region.name}, ${country.name})`,
            matchReasons: subregionMatchReasons,
            action: () => showSubregion(countryKey, regionKey, subregionKey)
          });
        }
      }

      for (const styleKey in (region.styles || {})) {
        const style = region.styles[styleKey];
        const styleMatchReasons = [];

        if (match(style.name)) {
          styleMatchReasons.push(`name: ${style.name}`);
        }

        if (match(style.style)) {
          styleMatchReasons.push(`style: ${style.style}`);
        }

        if (match(style.aging)) {
          styleMatchReasons.push(`aging: ${style.aging}`);
        }

        if (match(style.keyPoint)) {
          styleMatchReasons.push(`key point: ${style.keyPoint}`);
        }

        if (styleMatchReasons.length) {
          results.push({
            type: "style",
            label: `${style.name} (${region.name}, ${country.name})`,
            matchReasons: styleMatchReasons,
            action: () => showStyle(countryKey, styleKey, regionKey)
          });
        }
      }

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];

        let grapeMatchReasons = [];

        if (match(grapeKey)) {
          grapeMatchReasons.push(`name: ${grapeKey}`);
        }

        if (match(grape.summary)) {
          grapeMatchReasons.push(`summary: ${grape.summary}`);
        }

        if (match(grape.style)) {
          grapeMatchReasons.push(`style: ${grape.style}`);
        }

        if (match(grape.profile?.acidity)) {
          grapeMatchReasons.push(`acidity: ${grape.profile.acidity}`);
        }

        if (match(grape.profile?.alcohol)) {
          grapeMatchReasons.push(`alcohol: ${grape.profile.alcohol}`);
        }

        if (match(grape.profile?.body)) {
          grapeMatchReasons.push(`body: ${grape.profile.body}`);
        }

        if (match(grape.profile?.tannin)) {
          grapeMatchReasons.push(`tannin: ${grape.profile.tannin}`);
        }

        const matchedAliases = (grape.aliases || []).filter(alias =>
          String(alias).toLowerCase().includes(q)
        );
        if (matchedAliases.length) {
          grapeMatchReasons.push(`alias: ${matchedAliases[0]}`);
        }

        const matchedAromas = (grape.aromas || []).filter(aroma =>
          String(aroma).toLowerCase().includes(q)
        );
        if (matchedAromas.length) {
          grapeMatchReasons.push(`aroma: ${matchedAromas[0]}`);
        }

        const matchedViticulture = (grape.viticulture || []).filter(item =>
          String(item).toLowerCase().includes(q)
        );
        if (matchedViticulture.length) {
          grapeMatchReasons.push(`viticulture: ${matchedViticulture[0]}`);
        }

        const matchedWinemaking = (grape.winemaking || []).filter(item =>
          String(item).toLowerCase().includes(q)
        );
        if (matchedWinemaking.length) {
          grapeMatchReasons.push(`winemaking: ${matchedWinemaking[0]}`);
        }

        const matchedPairing = (grape.pairing || []).filter(item =>
          String(item).toLowerCase().includes(q)
        );
        if (matchedPairing.length) {
          grapeMatchReasons.push(`pairing: ${matchedPairing[0]}`);
        }

        const matchedTags = (grape.tags || []).filter(tag =>
          String(tag).toLowerCase().includes(q)
        );
        if (matchedTags.length) {
          grapeMatchReasons.push(`tag: ${matchedTags[0]}`);
        }

        const matchedTips = (grape.examTips || []).filter(tip =>
          String(tip).toLowerCase().includes(q)
        );
        if (matchedTips.length) {
          grapeMatchReasons.push(`exam tip: ${matchedTips[0]}`);
        }

        if (grapeMatchReasons.length) {
          results.push({
            type: "grape",
            label: `${grapeKey} (${region.name}, ${country.name})`,
            matchReasons: grapeMatchReasons,
            action: () => showGrape(countryKey, regionKey, grapeKey)
          });
        }
      }
    }
  }

  if (!results.length) {
    setPanelTitle("No result");
    setBreadcrumb([{ label: "Search" }, { label: q }]);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>No country, region, or grape found for "<b>${q}</b>".</p>
      </div>
    `;
    return;
  }

  setPanelTitle(`Search: ${query}`);
  setBreadcrumb([{ label: "Search" }, { label: query }]);

  const limitedResults = results.slice(0, 30);

  const countryResults = limitedResults.filter(r => r.type === "country");
  const styleResults = limitedResults.filter(r => r.type === "style");
  const regionResults = limitedResults.filter(r => r.type === "region");
  const subregionResults = limitedResults.filter(r => r.type === "subregion");
  const grapeResults = limitedResults.filter(r => r.type === "grape");

  const orderedResults = [
    ...countryResults,
    ...styleResults,
    ...regionResults,
    ...subregionResults,
    ...grapeResults
  ];

  let start = 0;
  const countryHtml = renderSearchGroup("Countries", countryResults, start);
  start += countryResults.length;

  const styleHtml = renderSearchGroup("Styles", styleResults, start);
  start += styleResults.length;

  const regionHtml = renderSearchGroup("Regions", regionResults, start);
  start += regionResults.length;

  const subregionHtml = renderSearchGroup("Sub-regions", subregionResults, start);
  start += subregionResults.length;

  const grapeHtml = renderSearchGroup("Grapes", grapeResults, start);

  byId("content").innerHTML = `
    ${countryHtml}
    ${styleHtml}
    ${regionHtml}
    ${subregionHtml}
    ${grapeHtml}
  `;

  document.querySelectorAll("[data-search-result]").forEach(el => {
    el.addEventListener("click", () => {
      const index = Number(el.dataset.searchResult);
      orderedResults[index].action();
    });
  });
}

// ================= STYLE =================
async function showStyle(countryKey, styleKey, regionKey = null) {
  showLoading("Loading style...");
  openSheetFull();
  const countryMeta = state.countriesData[countryKey];
  const country = await loadJson(`./data/${countryMeta.file}`);
  let style = null;
  let sourceRegionKey = regionKey;

  if (regionKey) {
    style = country.regions?.[regionKey]?.styles?.[styleKey];
  }

  if (!style) {
    for (const key in (country.regions || {})) {
      const region = country.regions[key];
      if (region.styles?.[styleKey]) {
        style = region.styles[styleKey];
        sourceRegionKey = key;
        break;
      }
    }
  }

  if (!style) return;

  showRegionMarkers(countryKey, country);
  showModeratingFactors(
    countryKey,
    sourceRegionKey,
    null,
    sourceRegionKey && country.regions?.[sourceRegionKey]?.mitigating
  );

  if (sourceRegionKey) {
    const regionCoords = getRegionCoords(countryKey, sourceRegionKey);
    if (showRegionBoundaryOverlay(countryKey, sourceRegionKey)) {
      focusMapOnLayerBounds(state.regionBoundaryLayer, 7);
    } else if (regionCoords) {
      map.flyTo(regionCoords, 7);
    }
  }

  setPanelTitle(style.name);
  const breadcrumb = [
    { label: country.name, click: () => showCountry(countryKey) }
  ];

  if (sourceRegionKey && country.regions?.[sourceRegionKey]) {
    const region = country.regions[sourceRegionKey];
    breadcrumb.push({
      label: region.name || sourceRegionKey,
      click: () => showRegion(countryKey, sourceRegionKey)
    });
  }

  breadcrumb.push({ label: style.name });
  setBreadcrumb(breadcrumb);

  byId("content").innerHTML = `
    <div class="section-card">
      <button class="btn secondary" id="backToStyleSource">← Back</button>
      <p><b>Style:</b> ${style.style}</p>
      <p><b>Aging:</b> ${style.aging}</p>
      <p><b>Key Point:</b> ${style.keyPoint}</p>
    </div>
  `;

  byId("backToStyleSource").onclick = () => {
    if (sourceRegionKey && country.regions?.[sourceRegionKey]) {
      showRegion(countryKey, sourceRegionKey);
    } else {
      showCountry(countryKey);
    }
  };
}

// ================= FILTER =================
function applyFilter(filter) {
  state.currentFilter = filter;
  restoreCountryMarkers();
}
// ================= HELPER =================
function getAccuracy() {
  const totalAnswered = state.progress.correctAnswers + state.progress.wrongAnswers;
  if (!totalAnswered) return 0;
  return Math.round((state.progress.correctAnswers / totalAnswered) * 100);
}

function getMostMissedCategory() {
  const entries = Object.entries(state.progress.weakAreas || {});
  if (!entries.length) return null;

  entries.sort((a, b) => b[1] - a[1]);
  return {
    category: entries[0][0],
    count: entries[0][1]
  };
}
function getMasteryLevel(count) {
  if (count >= 6) {
    return { label: "Needs Work", className: "bad" };
  }

  if (count >= 3) {
    return { label: "Improving", className: "mid" };
  }

  return { label: "Stable", className: "good" };
}

function buildMasteryHtml() {
  const weakEntries = Object.entries(state.progress.weakAreas || {})
    .sort((a, b) => b[1] - a[1]);

  if (!weakEntries.length) {
    return `<p class="empty-state">No category data yet.</p>`;
  }

  return `
    <div class="mastery-list">
      ${weakEntries.map(([category, count]) => {
        const mastery = getMasteryLevel(count);

        return `
          <div class="mastery-item">
            <div class="mastery-left">
              <div class="mastery-name">${category}</div>
              <div class="mastery-meta">${count} recorded wrong answers</div>
            </div>
            <div class="mastery-badge ${mastery.className}">${mastery.label}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderSearchGroup(title, items, startIndex = 0) {
  if (!items.length) return "";

  return `
    <div class="section-card">
      <p class="section-title">${title}</p>
      ${items.map((r, i) => `
        <div class="list-card">
          <div style="cursor:pointer;" data-search-result="${startIndex + i}">
            <div><b>${r.label}</b></div>
            ${r.matchReasons?.length ? `
              <div class="search-snippet">
                ${r.matchReasons.slice(0, 2).join(" • ")}
              </div>
            ` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}
function markPageAsStudied(pageKey) {
  if (!state.studiedPages.includes(pageKey)) {
    state.studiedPages.push(pageKey);
    saveStudiedPages();
  }
}

function unmarkPageAsStudied(pageKey) {
  state.studiedPages = state.studiedPages.filter(x => x !== pageKey);
  saveStudiedPages();
}

function renderStudyButtons(pageKey) {
  const studied = isStudiedPage(pageKey);

  return `
    <button class="btn secondary" id="studyPageBtn">📘 Study This Page</button>
    <button class="btn ${studied ? "" : "secondary"}" id="toggleStudiedBtn">
      ${studied ? "✅ Studied" : "☑️ Mark as Studied"}
    </button>
  `;
}

function bindStudyButtons(pageKey, onRefresh) {
  const studyBtn = byId("studyPageBtn");
  const toggleBtn = byId("toggleStudiedBtn");

  if (studyBtn) {
    studyBtn.onclick = () => {
      alert("Study Mode: Read this page carefully, then test yourself with Quiz This Page.");
    };
  }

  if (toggleBtn) {
    toggleBtn.onclick = () => {
      if (isStudiedPage(pageKey)) {
        unmarkPageAsStudied(pageKey);
      } else {
        markPageAsStudied(pageKey);
      }

      if (typeof onRefresh === "function") {
        onRefresh();
      }
    };
  }
}

function updateSheetMetrics() {
  const toolbar = byId("topToolbar");
  const toolbarToggle = byId("toolbarToggle");
  const searchInput = byId("searchInput");
  const root = document.documentElement;

  if (!sheet || !toolbar || !searchInput) return;

  const viewportHeight = window.innerHeight || 1;

  const toolbarRect = toolbar.getBoundingClientRect();
  const searchRect = searchInput.getBoundingClientRect();

  // mobile 用 filter button，desktop 用整個 toolbar
  const topGap = window.innerWidth <= 640
    ? Math.round((toolbarToggle?.getBoundingClientRect().top ?? toolbarRect.top))
    : Math.round(toolbarRect.top);

  // 呢個數愈大，sheet 愈高
  const desiredTop = Math.round(searchRect.bottom + topGap - 50);

  const sheetHeight = Math.max(400, Math.round(viewportHeight * 0.84));
  root.style.setProperty("--sheet-height", `${sheetHeight}px`);

  const openTranslate = ((viewportHeight - desiredTop - sheetHeight) / sheetHeight) * 100;

  if (window.innerWidth <= 1024) {
    SHEET_STATES = {
      collapsed: 84,
      mid: 38,
      open: Math.max(-45, Math.min(0, openTranslate))
    };
  } else {
    SHEET_STATES = {
      collapsed: 82,
      mid: 32,
      open: Math.max(-45, Math.min(0, openTranslate))
    };
  }

  sheet.style.setProperty("--sheet-translate", `${SHEET_STATES[currentSheetState] ?? 32}%`);
  updateMapControlInsets();
}

function updateMapControlInsets() {
  const toolbar = byId("topToolbar");
  const root = document.documentElement;

  if (!toolbar || !sheet || !root) return;

  const viewportHeight = window.innerHeight || 1;
  const toolbarRect = toolbar.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();

  const topInset = Math.max(16, Math.round(toolbarRect.bottom + 12));
  const bottomInset = Math.max(16, Math.round(viewportHeight - sheetRect.top + 12));

  root.style.setProperty("--map-control-top", `${topInset}px`);
  root.style.setProperty("--map-control-bottom", `${bottomInset}px`);
}

// ================= BUILD QUIZ FOR GRAPE & REGION =================
async function buildQuizForGrape(grapeKey, grape, regionName, countryName) {
  const questions = [];

  const allGrapeNames = await getAllGrapeNames();
  const allRegionNames = await getAllRegionNames();
  const allAromas = await getAllAromas();
  const allAliases = await getAllAliases();
  const allPairings = await getAllPairings();

  if (grape.style) {
    questions.push({
      category: "style",
      question: `Which description best matches ${grapeKey}?`,
      choices: buildChoices(
        grape.style,
        [
          "Light, neutral and low-acid",
          "Always sweet and fortified",
          "Deep colour with no acidity",
          "Fresh, aromatic and unoaked"
        ]
      ),
      answer: grape.style,
      explanation: grape.style
    });
  }

  if (grape.aromas?.length) {
    const correct = grape.aromas[0];
    questions.push({
      category: "aroma",
      question: `Which aroma is commonly associated with ${grapeKey}?`,
      choices: buildChoices(correct, allAromas),
      answer: correct,
      explanation: `${grapeKey} is commonly linked with aromas such as ${grape.aromas.join(", ")}.`
    });
  }

  if (grape.aliases?.length) {
    const correct = grape.aliases[0];
    questions.push({
      category: "alias",
      question: `Which is an alias of ${grapeKey}?`,
      choices: buildChoices(correct, allAliases),
      answer: correct,
      explanation: `${correct} is listed as an alias of ${grapeKey}.`
    });
  }

  if (grape.profile?.acidity) {
    questions.push({
      category: "acidity",
      question: `What acidity level is typical for ${grapeKey}?`,
      choices: buildChoices(grape.profile.acidity, ["Low", "Medium-", "Medium", "Medium+", "High", "Light", "Full"]),
      answer: grape.profile.acidity,
      explanation: `${grapeKey} is typically described as ${grape.profile.acidity} in acidity.`
    });
  }

  if (grape.profile?.body) {
    questions.push({
      category: "body",
      question: `What body level is typical for ${grapeKey}?`,
      choices: buildChoices(grape.profile.body, ["Low", "Medium-", "Medium", "Medium+", "High", "Light", "Full"]),
      answer: grape.profile.body,
      explanation: `${grapeKey} is typically described as ${grape.profile.body} in body.`
    });
  }

  if (grape.profile?.tannin) {
    questions.push({
      category: "tannin",
      question: `What tannin level is typical for ${grapeKey}?`,
      choices: buildChoices(grape.profile.tannin, ["Low", "Medium-", "Medium", "Medium+", "High", "Light", "Full"]),
      answer: grape.profile.tannin,
      explanation: `${grapeKey} is typically described as ${grape.profile.tannin} in tannin.`
    });
  }

  if (grape.profile?.alcohol) {
    questions.push({
      category: "alcohol",
      question: `What alcohol level is typical for ${grapeKey}?`,
      choices: buildChoices(grape.profile.alcohol, ["Low", "Medium-", "Medium", "Medium+", "High", "Light", "Full"]),
      answer: grape.profile.alcohol,
      explanation: `${grapeKey} is typically described as ${grape.profile.alcohol} in alcohol.`
    });
  }

  if (grape.pairing?.length) {
    const correct = grape.pairing[0];
    questions.push({
      category: "pairing",
      question: `Which food pairing works well with ${grapeKey}?`,
      choices: buildChoices(correct, allPairings),
      answer: correct,
      explanation: `${grapeKey} pairs well with foods such as ${grape.pairing.join(", ")}.`
    });
  }

  questions.push({
    category: "origin",
    question: `${grapeKey} is shown under which region in your atlas?`,
    choices: buildChoices(regionName, allRegionNames),
    answer: regionName,
    explanation: `${grapeKey} is listed under ${regionName}, ${countryName}.`
  });

  questions.push({
    category: "grape",
    question: `Which grape is this profile describing?`,
    choices: buildChoices(grapeKey, allGrapeNames),
    answer: grapeKey,
    explanation: `${grapeKey} is the correct grape for this profile in your atlas.`
  });

  return questions;
}

async function buildQuizForRegion(regionKey, region, countryName) {
  const questions = [];

  const allRegionNames = await getAllRegionNames();
  const allCountryNames = getAllCountryNames();
  const allGrapeNames = await getAllGrapeNames();
  const allStudyFacts = await getAllStudyFacts();
  const allAgingFacts = await getAllAgingFacts();
  const allProductionFacts = await getAllProductionFacts();

  if (region.climate) {
    questions.push({
      category: "climate",
      question: `What climate best describes ${region.name}?`,
      choices: buildChoices(region.climate, WSET_CLIMATE_OPTIONS),
      answer: region.climate,
      explanation: `${region.name} is typically described as ${region.climate}.`
    });
  }

  if (region.styleSummary || region.style) {
    const correctStyle = region.styleSummary || region.style;
    questions.push({
      category: "style",
      question: `Which wine style is typical of ${region.name}?`,
      choices: buildChoices(correctStyle, [
        "Light, neutral wines",
        "Always sweet wines",
        "Fortified wines only",
        "Fresh sparkling wines"
      ]),
      answer: correctStyle,
      explanation: `${region.name} is known for ${correctStyle}.`
    });
  }

  if (region.classification) {
    questions.push({
      category: "classification",
      question: `Which classification statement best matches ${region.name}?`,
      choices: buildChoices(region.classification, allStudyFacts),
      answer: region.classification,
      explanation: region.classification
    });
  }

  if (region.lawNotes?.length) {
    const correctLawNote = region.lawNotes[0];
    questions.push({
      category: "law",
      question: `Which statement is true of ${region.name}?`,
      choices: buildChoices(correctLawNote, allStudyFacts),
      answer: correctLawNote,
      explanation: correctLawNote
    });
  }

  if (region.vineyardFactors?.length) {
    const correctVineyardFactor = region.vineyardFactors[0];
    questions.push({
      category: "vineyard factors",
      question: `Which vineyard factor is especially important in ${region.name}?`,
      choices: buildChoices(correctVineyardFactor, allStudyFacts),
      answer: correctVineyardFactor,
      explanation: correctVineyardFactor
    });
  }

  if (region.humanFactors?.length) {
    const correctHumanFactor = region.humanFactors[0];
    questions.push({
      category: "human factors",
      question: `Which human factor is especially important in ${region.name}?`,
      choices: buildChoices(correctHumanFactor, allStudyFacts),
      answer: correctHumanFactor,
      explanation: correctHumanFactor
    });
  }

  const regionStyles = Object.values(region.styles || {});
  const styleWithAging = regionStyles.find(style => style?.aging);
  if (styleWithAging?.aging) {
    questions.push({
      category: "ageing",
      question: `Which ageing or maturation statement is linked to ${region.name}?`,
      choices: buildChoices(styleWithAging.aging, allAgingFacts),
      answer: styleWithAging.aging,
      explanation: `${styleWithAging.name || region.name}: ${styleWithAging.aging}.`
    });
  }

  const styleWithKeyPoint = regionStyles.find(style => style?.keyPoint);
  if (styleWithKeyPoint?.keyPoint) {
    questions.push({
      category: "production",
      question: `Which production or exam point is linked to ${region.name}?`,
      choices: buildChoices(styleWithKeyPoint.keyPoint, allProductionFacts),
      answer: styleWithKeyPoint.keyPoint,
      explanation: `${styleWithKeyPoint.name || region.name}: ${styleWithKeyPoint.keyPoint}.`
    });
  }

  const grapeKeys = Object.keys(region.grapes || {});
  if (grapeKeys.length) {
    const correct = grapeKeys[0];
    questions.push({
      category: "grapes",
      question: `Which grape is commonly found in ${region.name}?`,
      choices: buildChoices(correct, allGrapeNames),
      answer: correct,
      explanation: `${correct} is listed in ${region.name}.`
    });
  }

  questions.push({
    category: "origin",
    question: `${region.name} belongs to which country?`,
    choices: buildChoices(countryName, allCountryNames),
    answer: countryName,
    explanation: `${region.name} is part of ${countryName}.`
  });

  grapeKeys.slice(0, 2).forEach(grapeName => {
    questions.push({
      category: "region-grape",
      question: `${grapeName} is associated with which region?`,
      choices: buildChoices(region.name, allRegionNames),
      answer: region.name,
      explanation: `${grapeName} appears under ${region.name}.`
    });
  });

  return questions;
}

function shuffleArray(arr) {
  const cloned = [...arr];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function uniqueValues(arr = []) {
  return [...new Set(arr.filter(Boolean).map(x => String(x).trim()))];
}

function buildChoices(correct, pool = [], count = 4) {
  const cleanedCorrect = String(correct).trim();

  const distractors = shuffleArray(
    uniqueValues(pool).filter(x => x !== cleanedCorrect)
  ).slice(0, count - 1);

  return shuffleArray(uniqueValues([cleanedCorrect, ...distractors]));
}

function getAllCountryNames() {
  return uniqueValues(
    Object.values(state.countriesData || {}).map(c => c.name)
  );
}

async function getAllRegionNames() {
  const names = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];
      names.push(region.name || regionKey);
    }
  }

  return uniqueValues(names);
}

async function getAllStudyFacts() {
  const facts = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const region of Object.values(country.regions || {})) {
      if (region.classification) facts.push(region.classification);
      if (region.lawNotes?.length) facts.push(...region.lawNotes);
      if (region.vineyardFactors?.length) facts.push(...region.vineyardFactors);
      if (region.humanFactors?.length) facts.push(...region.humanFactors);

      for (const subregion of Object.values(region.subregions || {})) {
        if (subregion.classification) facts.push(subregion.classification);
        if (subregion.lawNotes?.length) facts.push(...subregion.lawNotes);
        if (subregion.vineyardFactors?.length) facts.push(...subregion.vineyardFactors);
        if (subregion.humanFactors?.length) facts.push(...subregion.humanFactors);
      }
    }
  }

  return uniqueValues(facts);
}

async function getAllAgingFacts() {
  const facts = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const region of Object.values(country.regions || {})) {
      for (const style of Object.values(region.styles || {})) {
        if (style?.aging) facts.push(style.aging);
      }
    }
  }

  return uniqueValues(facts);
}

async function getAllProductionFacts() {
  const facts = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const region of Object.values(country.regions || {})) {
      for (const style of Object.values(region.styles || {})) {
        if (style?.keyPoint) facts.push(style.keyPoint);
      }
    }
  }

  return uniqueValues(facts);
}

async function getAllGrapeNames() {
  const names = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      for (const grapeKey in (region.grapes || {})) {
        names.push(grapeKey);
      }
    }
  }

  return uniqueValues(names);
}

async function getAllAromas() {
  const aromas = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];
        aromas.push(...(grape.aromas || []));
      }
    }
  }

  return uniqueValues(aromas);
}

async function getAllAliases() {
  const aliases = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];
        aliases.push(...(grape.aliases || []));
      }
    }
  }

  return uniqueValues(aliases);
}

async function getAllPairings() {
  const pairings = [];

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];
        pairings.push(...(grape.pairing || []));
      }
    }
  }

  return uniqueValues(pairings);
}
// ================= RENDER METER =================
function renderMeter(label, value) {
  const raw = String(value || "").trim().toLowerCase();

  function normalizeLevel(text) {
    if (!text) return 0;

    // cleanup common wording
    const cleaned = text
      .replace(/acidity|acid|alcohol|body|bodied|tannin|tannins/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // strongest / most specific first
    if (
      cleaned.includes("medium to high") ||
      cleaned.includes("medium-high") ||
      cleaned.includes("medium high") ||
      cleaned.includes("med-high") ||
      cleaned.includes("moderately high")
    ) {
      return 4;
    }

    if (
      cleaned.includes("medium to low") ||
      cleaned.includes("medium-low") ||
      cleaned.includes("medium low") ||
      cleaned.includes("med-low") ||
      cleaned.includes("moderately low")
    ) {
      return 2;
    }

    if (
      cleaned === "light" ||
      cleaned.includes("light-bodied") ||
      cleaned.includes("light bodied")
    ) {
      return 1;
    }

    if (cleaned.includes("low")) {
      return 1;
    }

    if (cleaned === "medium-" || cleaned.includes("medium-")) {
      return 2;
    }

    if (cleaned === "medium") {
      return 3;
    }

    if (cleaned === "medium+" || cleaned.includes("medium+")) {
      return 4;
    }

    if (cleaned.includes("high")) {
      return 5;
    }

    // fallback if only "full-bodied" appears
    if (
      cleaned.includes("full-bodied") ||
      cleaned.includes("full bodied") ||
      cleaned.includes("full")
    ) {
      return 5;
    }

    return 0;
  }

  const level = normalizeLevel(raw);

  return `
    <div class="meter-row">
      <div class="meter-label">${label}</div>
      <div class="meter-dots" title="${value || "-"}">
        ${[1, 2, 3, 4, 5].map(i =>
          `<div class="meter-dot ${i <= level ? "filled" : ""}"></div>`
        ).join("")}
      </div>
    </div>
  `;
}

// ================= PROGRESS =================
function showProgress() {
  restoreCountryMarkers();
  setPanelTitle("Progress Dashboard");
  setBreadcrumb([{ label: "Progress" }]);

  const totalAnswered = state.progress.correctAnswers + state.progress.wrongAnswers;
  const accuracy = getAccuracy();
  const mostMissed = getMostMissedCategory();

  const weakEntries = Object.entries(state.progress.weakAreas || {})
    .sort((a, b) => b[1] - a[1]);

  const maxWeak = weakEntries.length ? weakEntries[0][1] : 1;

  const weakHtml = weakEntries.length
    ? `
      <div class="bar-list">
        ${weakEntries.map(([category, count]) => {
          const width = Math.max(8, Math.round((count / maxWeak) * 100));
          return `
            <div class="bar-row">
              <div class="bar-label">${category}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${width}%"></div>
              </div>
              <div class="bar-value">${count}</div>
            </div>
          `;
        }).join("")}
      </div>
    `
    : `<p class="empty-state">No weak areas recorded yet.</p>`;

  const masteryHtml = buildMasteryHtml();

  byId("content").innerHTML = `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-label">Quizzes Played</div>
        <div class="stat-value">${state.progress.quizzesPlayed}</div>
        <div class="stat-sub">Completed quiz sessions</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Accuracy</div>
        <div class="stat-value">${accuracy}%</div>
        <div class="stat-sub">${state.progress.correctAnswers} correct / ${totalAnswered} answered</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Correct Answers</div>
        <div class="stat-value">${state.progress.correctAnswers}</div>
        <div class="stat-sub">Lifetime correct answers</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Most Missed</div>
        <div class="stat-value">${mostMissed ? mostMissed.category : "-"}</div>
        <div class="stat-sub">${mostMissed ? `${mostMissed.count} wrong answers` : "No data yet"}</div>
      </div>
    </div>

    <div class="section-card">
      <p class="section-title">Weak Areas</p>
      ${weakHtml}
    </div>

    <div class="section-card">
      <p class="section-title">Category Mastery</p>
      ${masteryHtml}
    </div>

    <div class="section-card">
      <p class="section-title">Actions</p>
      <div class="dashboard-actions">
        <button class="btn secondary" id="resetProgressBtn">Reset Progress</button>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-label">Studied Pages</div>
      <div class="stat-value">${state.studiedPages.length}</div>
      <div class="stat-sub">Country / region / grape pages marked studied</div>
    </div>
  `;

  const resetBtn = byId("resetProgressBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetProgressData);
  }
}

function resetProgressData() {
  const confirmed = window.confirm("Reset all quiz progress and weak area data?");
  if (!confirmed) return;

  state.progress = {
    quizzesPlayed: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    weakAreas: {}
  };

  state.studiedPages = [];

  localStorage.setItem("wineProgress", JSON.stringify(state.progress));
  localStorage.setItem("wineStudiedPages", JSON.stringify(state.studiedPages));

  showProgress();
}

const sheet = document.getElementById("bottomSheet");
const handle = document.querySelector(".sheet-handle");
const handleWrap = document.querySelector(".sheet-handle-wrap");
const sheetBody = document.getElementById("sheetBody");

let SHEET_STATES = {
  collapsed: 82,
  mid: 32,
  open: 8
};

let currentSheetState = "mid";
let dragStartY = 0;
let dragCurrentY = 0;
let dragStartTranslate = SHEET_STATES.mid;
let dragStartTime = 0;
let draggingSheet = false;
let dragSource = null; // "handle" | "content"

function applySheetState(stateName) {
  currentSheetState = stateName;
  sheet.classList.remove("state-collapsed", "state-mid", "state-open");
  sheet.classList.add(`state-${stateName}`);

  const translate = SHEET_STATES[stateName] ?? 32;
  sheet.style.setProperty("--sheet-translate", `${translate}%`);
  sheet.style.transform = "";

  updateMapControlInsets();
  refreshMapLayout();
}

function getCurrentTranslatePercent() {
  return SHEET_STATES[currentSheetState];
}

function getSheetHeightPx() {
  const styleValue = getComputedStyle(document.documentElement)
    .getPropertyValue("--sheet-height")
    .trim();
  const parsed = parseFloat(styleValue);
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return sheet?.offsetHeight || window.innerHeight || 1;
}

function getRenderedTranslatePercent() {
  const transform = sheet.style.transform || "";
  const match = transform.match(/translateY\((-?\d+(?:\.\d+)?)%\)/);
  if (match) return Number(match[1]);

  const cssVar = parseFloat(sheet.style.getPropertyValue("--sheet-translate"));
  if (!Number.isNaN(cssVar)) return cssVar;

  return SHEET_STATES[currentSheetState];
}

function getOrderedSheetStates() {
  return Object.entries(SHEET_STATES)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.value - b.value);
}

function getNearestSheetStateName(translatePercent) {
  const states = getOrderedSheetStates();
  return states.reduce((closest, entry) => {
    const currentDiff = Math.abs(entry.value - translatePercent);
    const closestDiff = Math.abs(closest.value - translatePercent);
    return currentDiff < closestDiff ? entry : closest;
  }, states[0]).name;
}

function getAdjacentSheetStateName(baseStateName, direction) {
  const states = getOrderedSheetStates();
  const index = states.findIndex(entry => entry.name === baseStateName);
  if (index === -1) return baseStateName;
  const nextIndex = Math.max(0, Math.min(states.length - 1, index + direction));
  return states[nextIndex].name;
}

function getSheetSnapDirection(velocityPxMs, dragDistanceY) {
  if (Math.abs(velocityPxMs) > 0.05) {
    return velocityPxMs < 0 ? -1 : 1;
  }

  if (Math.abs(dragDistanceY) > 6) {
    return dragDistanceY < 0 ? -1 : 1;
  }

  return 0;
}

function setSheetTranslate(percent) {
  const clamped = Math.max(SHEET_STATES.open, Math.min(SHEET_STATES.collapsed, percent));
  sheet.style.transform = `translateY(${clamped}%)`;
  sheet.style.setProperty("--sheet-translate", `${clamped}%`);
}

function startSheetDrag(clientY, source = "handle") {
  dragStartY = clientY;
  dragCurrentY = clientY;
  dragStartTranslate = getRenderedTranslatePercent();
  dragStartTime = performance.now();
  draggingSheet = true;
  dragSource = source;
  sheet.style.transition = "none";
}

function moveSheetDrag(clientY) {
  if (!draggingSheet) return;

  dragCurrentY = clientY;
  const deltaY = dragCurrentY - dragStartY;

  const sheetHeight = getSheetHeightPx();
  const deltaPercent = (deltaY / sheetHeight) * 100;
  const next = dragStartTranslate + deltaPercent;

  setSheetTranslate(next);
}

function endSheetDrag() {
  if (!draggingSheet) return;

  draggingSheet = false;
  sheet.style.transition = "transform 0.26s ease";

  const now = performance.now();
  const dragDistanceY = dragCurrentY - dragStartY;
  const dragDurationMs = Math.max(1, now - dragStartTime);
  const velocityPxMs = dragDistanceY / dragDurationMs;

  const currentTranslate = getRenderedTranslatePercent();
  const sheetHeight = getSheetHeightPx();
  const projectedTranslate = currentTranslate + ((velocityPxMs * 120) / sheetHeight) * 100;
  const clampedProjected = Math.max(
    SHEET_STATES.open,
    Math.min(SHEET_STATES.collapsed, projectedTranslate)
  );

  const isFling = Math.abs(velocityPxMs) > 0.45 || Math.abs(dragDistanceY) > 120;
  let targetState = getNearestSheetStateName(clampedProjected);

  if (isFling) {
    const direction = getSheetSnapDirection(velocityPxMs, dragDistanceY);
    const base = getNearestSheetStateName(dragStartTranslate);
    if (direction !== 0) {
      targetState = getAdjacentSheetStateName(base, direction);
    }
  }

  applySheetState(targetState);

  dragSource = null;
}

function onPointerMove(clientY) {
  moveSheetDrag(clientY);
}

function onPointerUp() {
  endSheetDrag();
}

if (sheet && handle && handleWrap && sheetBody) {
  applySheetState("collapsed");

  // 1) Handle 區永遠只負責 drag
  handleWrap.addEventListener("touchstart", (e) => {
    startSheetDrag(e.touches[0].clientY, "handle");
  }, { passive: true });

  handleWrap.addEventListener("mousedown", (e) => {
    startSheetDrag(e.clientY, "handle");
  });

  window.addEventListener("touchmove", (e) => {
    if (!draggingSheet || dragSource !== "handle") return;
    e.preventDefault();
    onPointerMove(e.touches[0].clientY);
  }, { passive: false });

  window.addEventListener("touchend", () => {
    onPointerUp();
  });

  window.addEventListener("touchcancel", () => {
    onPointerUp();
  });

  window.addEventListener("mousemove", (e) => {
    if (!draggingSheet) return;
    onPointerMove(e.clientY);
  });

  window.addEventListener("mouseup", () => {
    onPointerUp();
  });
}

function refreshMapLayout() {
  setTimeout(() => {
    updateMapControlInsets();
    map.invalidateSize();
  }, 280);
}

function resetSheetScroll() {
  if (sheetBody) {
    sheetBody.scrollTop = 0;
  }
}

function openSheetMid() {
  applySheetState("mid");
  refreshMapLayout();
}

function openSheetFull({ resetScroll = true } = {}) {
  applySheetState("open");
  if (resetScroll) {
    resetSheetScroll();
  }
  refreshMapLayout();
}

// ================= AROMA CHIPS =================
function renderChips(items = []) {
  if (!items.length) return "";

  return `
    <div class="chips">
      ${items.map(item => `<div class="chip">${item}</div>`).join("")}
    </div>
  `;
}

function getPairingIcon(item = "") {
  const text = String(item).toLowerCase();

  if (text.includes("duck")) return "🦆";
  if (text.includes("chicken")) return "🍗";
  if (text.includes("beef") || text.includes("steak")) return "🥩";
  if (text.includes("lamb")) return "🐑";
  if (text.includes("pork")) return "🐖";
  if (text.includes("salmon") || text.includes("fish") || text.includes("seafood")) return "🐟";
  if (text.includes("shellfish") || text.includes("shrimp") || text.includes("prawn")) return "🦐";
  if (text.includes("cheese")) return "🧀";
  if (text.includes("mushroom")) return "🍄";
  if (text.includes("pasta")) return "🍝";
  if (text.includes("spicy")) return "🌶️";
  if (text.includes("bbq") || text.includes("barbecue")) return "🔥";
  if (text.includes("dessert") || text.includes("cake")) return "🍰";
  if (text.includes("fruit")) return "🍎";
  if (text.includes("vegetable") || text.includes("veg")) return "🥗";

  return "🍽️";
}

function getAromaIcon(item = "") {
  const text = String(item).toLowerCase();

  // citrus
  if (text.includes("lemon") || text.includes("lime") || text.includes("citrus")) return "🍋";

  // orchard fruit
  if (text.includes("apple") || text.includes("pear")) return "🍏";

  // stone fruit
  if (text.includes("peach") || text.includes("apricot")) return "🍑";

  // tropical
  if (text.includes("pineapple") || text.includes("mango") || text.includes("tropical")) return "🍍";

  // red fruit
  if (text.includes("cherry") || text.includes("raspberry") || text.includes("strawberry")) return "🍒";

  // dark fruit
  if (text.includes("blackberry") || text.includes("blackcurrant") || text.includes("plum")) return "🍇";

  // floral
  if (text.includes("floral") || text.includes("rose") || text.includes("violet")) return "🌸";

  // herbaceous
  if (text.includes("herb") || text.includes("grass") || text.includes("green")) return "🌿";

  // spice
  if (text.includes("spice") || text.includes("pepper") || text.includes("clove")) return "🧂";

  // earthy
  if (text.includes("earth") || text.includes("mushroom") || text.includes("forest")) return "🍄";

  // oak
  if (text.includes("vanilla") || text.includes("oak") || text.includes("toast")) return "🪵";

  // petrol (Riesling)
  if (text.includes("petrol") || text.includes("kerosene")) return "⛽";

  return "👃";
}

function renderPairingChips(items = []) {
  if (!items.length) return "";

  return `
    <div class="chips">
      ${items.map(item => `
        <div class="pairing-chip">
          <span class="pairing-icon">${getPairingIcon(item)}</span>
          <span>${item}</span>
        </div>
      `).join("")}
    </div>
  `;
}
function renderAromaChips(items = []) {
  if (!items.length) return "";

  return `
    <div class="chips">
      ${items.map(item => `
        <div class="pairing-chip">
          <span class="pairing-icon">${getAromaIcon(item)}</span>
          <span>${item}</span>
        </div>
      `).join("")}
    </div>
  `;
}

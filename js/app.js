import { state } from "./state.js";
import { byId, debounce, loadJson, saveFavorites, parseFavorite } from "./utils.js";
import { setBreadcrumb, setPanelTitle, showLoading } from "./ui.js";
import { startQuiz, buildGeneratedQuestions } from "./quiz.js";

let recent = JSON.parse(localStorage.getItem("wineRecent") || "[]");

function saveRecent() {
  localStorage.setItem("wineRecent", JSON.stringify(recent));
}

// ================= MAP =================
const map = L.map("map").setView([25, 10], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// ================= INIT =================
async function init() {
  showLoading("Loading Wine Atlas...");
  state.countriesData = await loadJson("./data/countries.json");
  state.quizQuestions = [];

  Object.keys(state.countriesData).forEach(key => {
    const c = state.countriesData[key];
    if (!c.coords) return;

    const marker = L.marker(c.coords).addTo(map);
    marker.on("click", () => showCountry(key));
    state.markers[key] = marker;
  });

  byId("searchInput").addEventListener("input", debounce(function (e) {
    searchAll(e.target.value);
  }, 250));

  byId("quizBtn").addEventListener("click", () => startQuiz(true));
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

  byId("content").innerHTML = `
  <div class="section-card">
    <p class="section-title">Welcome</p>
    <p>Explore wine countries, regions, grapes, and styles from the map.</p>
    <p>Use Search, Quiz, Favorites, and Progress to build your knowledge.</p>
  </div>
`;
  const toolbar = byId("topToolbar");
  const toolbarToggle = byId("toolbarToggle");

  if (toolbar && toolbarToggle) {
    toolbarToggle.addEventListener("click", () => {
      toolbar.classList.toggle("expanded");
      toolbarToggle.textContent = toolbar.classList.contains("expanded")
        ? "Filters ▴"
        : "Filters ▾";
    });
  }
}

init();

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

    if (countryMeta.coords && countryMeta.zoom) {
      map.flyTo(countryMeta.coords, countryMeta.zoom);
    }

    let html = `
      <div class="section-card">
        <p><b>Country:</b> ${country.name}</p>
        ${country.summary ? `<p><b>Summary:</b> ${country.summary}</p>` : ""}
        ${country.examTips?.length ? `<p><b>Exam Tips:</b> ${country.examTips.join(" / ")}</p>` : ""}
        <p><b>Regions:</b></p>
    `;

    const regionKeys = Object.keys(country.regions || {});
    if (regionKeys.length) {
      html += regionKeys.map(regionKey => {
        const region = country.regions?.[regionKey];
        const label = region?.name || regionKey;
        return `
          <button class="pill" data-region="${regionKey}">
            ${label}
          </button>
        `;
      }).join("");
    } else {
      html += `<p>No regions available.</p>`;
    }

    html += `</div>`;

    if (country.styles && Object.keys(country.styles).length) {
      html += `
        <div class="section-card">
          <p class="section-title">Styles</p>
          ${Object.keys(country.styles).map(styleKey => {
            const style = country.styles?.[styleKey];
            const label = style?.name || styleKey;
            return `
              <button class="btn" data-style="${styleKey}">
                ${label}
              </button>
            `;
          }).join("")}
        </div>
      `;
    }

    byId("content").innerHTML = html;

    document.querySelectorAll("[data-region]").forEach(btn => {
      btn.addEventListener("click", () => showRegion(countryKey, btn.dataset.region));
    });

    document.querySelectorAll("[data-style]").forEach(btn => {
      btn.addEventListener("click", () => showStyle(countryKey, btn.dataset.style));
    });
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
  openSheetFull();
  try {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);
    const region = country.regions?.[regionKey];
    if (!region) return;

    setPanelTitle(region.name || regionKey);
    setBreadcrumb([
      { label: country.name || countryKey, click: () => showCountry(countryKey) },
      { label: region.name || regionKey }
    ]);

    let html = `
      <div class="section-card">
        <button class="btn secondary" id="backToCountry">← Back</button>
        <p><b>Region:</b> ${region.name || regionKey}</p>
        ${region.summary ? `<p><b>Summary:</b> ${region.summary}</p>` : ""}
        <p><b>Climate:</b> ${region.climate || "-"}</p>
        <p><b>Style:</b> ${region.styleSummary || "-"}</p>
        ${region.keyGrapes?.length ? `<p><b>Key Grapes:</b> ${region.keyGrapes.join(", ")}</p>` : ""}
        <p><b>Grapes:</b></p>
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

    if (country.styles && Object.keys(country.styles).length) {
      html += `
        <div class="section-card">
          <p><b>Styles:</b></p>
          ${Object.keys(country.styles).map(styleKey => {
            const style = country.styles?.[styleKey];
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

    byId("backToCountry").onclick = () => showCountry(countryKey);

    document.querySelectorAll("[data-grape]").forEach(btn => {
      btn.addEventListener("click", () => showGrape(countryKey, regionKey, btn.dataset.grape));
    });

    document.querySelectorAll("[data-style]").forEach(btn => {
      btn.addEventListener("click", () => showStyle(countryKey, btn.dataset.style));
    });
  } catch (err) {
    console.error("showRegion failed:", err);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>Failed to load region details.</p>
      </div>
    `;
  }
}

// ================= GRAPE =================
async function showGrape(countryKey, regionKey, grapeKey) {
  showLoading("Loading grape profile...");
  openSheetFull();
  const countryMeta = state.countriesData[countryKey];
  const country = await loadJson(`./data/${countryMeta.file}`);
  const grape = country.regions[regionKey]?.grapes?.[grapeKey];
  if (!grape) return;

  setPanelTitle(grapeKey);
  setBreadcrumb([
    { label: country.name, click: () => showCountry(countryKey) },
    { label: country.regions[regionKey].name, click: () => showRegion(countryKey, regionKey) },
    { label: grapeKey }
  ]);

  byId("content").innerHTML = `
    <div class="section-card">
      <button class="btn secondary" id="backToRegion">← Back</button>
      <button class="btn" id="favBtn">⭐ Favorite</button>
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

    ${grape.aromas?.length ? `
      <div class="section-card">
        <p class="section-title">Aromas</p>
        <div>${grape.aromas.map(x => `<span class="pill">${x}</span>`).join("")}</div>
      </div>
    ` : ""}

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
        <div>${grape.pairing.map(x => `<span class="pill">${x}</span>`).join("")}</div>
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
  byId("backToRegion").onclick = () => showRegion(countryKey, regionKey);

  byId("favBtn").onclick = () => {
    const item = `${country.name} > ${country.regions[regionKey].name} > ${grapeKey}`;

    if (!state.favorites.includes(item)) {
      state.favorites.push(item);
      saveFavorites();
      alert("Added to favorites");
    } else {
      alert("Already in favorites");
    }
  };

  const item = `${country.name} > ${country.regions[regionKey].name} > ${grapeKey}`;
  recent = recent.filter(x => x !== item);
  recent.unshift(item);
  recent = recent.slice(0, 10);
  saveRecent();
}

// ================= FAVORITES =================
function showFavorites() {
  showLoading("Loading favorites...");
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

// ================= SEARCH =================
async function searchAll(query) {
  const q = String(query || "").trim().toLowerCase();

  if (!q) {
    setPanelTitle("Click a country");
    setBreadcrumb([]);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>Select a country on the map, or search for a region or grape.</p>
      </div>
    `;
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

    if (
      match(country.name) ||
      match(country.summary) ||
      matchArray(country.tags) ||
      matchArray(country.examTips)
    ) {
      results.push({
        type: "country",
        label: `${country.name}`,
        action: () => showCountry(countryKey)
      });
    }

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      if (
        match(region.name) ||
        match(region.summary) ||
        match(region.climate) ||
        match(region.styleSummary) ||
        matchArray(region.keyGrapes) ||
        matchArray(region.tags) ||
        matchArray(region.examTips) ||
        matchArray(region.mitigating)
      ) {
        results.push({
          type: "region",
          label: `${region.name} (${country.name})`,
          action: () => showRegion(countryKey, regionKey)
        });
      }

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];

        if (
          match(grapeKey) ||
          match(grape.summary) ||
          match(grape.style) ||
          match(grape.profile?.acidity) ||
          match(grape.profile?.alcohol) ||
          match(grape.profile?.body) ||
          match(grape.profile?.tannin) ||
          matchArray(grape.aliases) ||
          matchArray(grape.aromas) ||
          matchArray(grape.viticulture) ||
          matchArray(grape.winemaking) ||
          matchArray(grape.pairing) ||
          matchArray(grape.tags) ||
          matchArray(grape.examTips)
        ) {
          results.push({
            type: "grape",
            label: `${grapeKey} (${region.name}, ${country.name})`,
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

  byId("content").innerHTML = `
    <div class="section-card">
      <p class="section-title">Search Results</p>
      ${results.slice(0, 30).map((r, i) => `
        <div class="list-card">
          <div style="cursor:pointer;" data-search-result="${i}">
            <b>${r.type.toUpperCase()}</b> — ${r.label}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  document.querySelectorAll("[data-search-result]").forEach(el => {
    el.addEventListener("click", () => {
      const index = Number(el.dataset.searchResult);
      results[index].action();
    });
  });
}

// ================= STYLE =================
async function showStyle(countryKey, styleKey) {
  showLoading("Loading grape profile...");
  openSheetFull();
  const countryMeta = state.countriesData[countryKey];
  const country = await loadJson(`./data/${countryMeta.file}`);
  const style = country.styles?.[styleKey];
  if (!style) return;

  setPanelTitle(style.name);
  setBreadcrumb([
    { label: country.name, click: () => showCountry(countryKey) },
    { label: style.name }
  ]);

  byId("content").innerHTML = `
    <div class="section-card">
      <button class="btn secondary" id="backToCountry">← Back</button>
      <p><b>Style:</b> ${style.style}</p>
      <p><b>Aging:</b> ${style.aging}</p>
      <p><b>Key Point:</b> ${style.keyPoint}</p>
    </div>
  `;

  byId("backToCountry").onclick = () => showCountry(countryKey);
}

// ================= FILTER =================
function applyFilter(filter) {
  state.currentFilter = filter;

  Object.keys(state.markers).forEach(key => {
    const c = state.countriesData[key];
    const marker = state.markers[key];

    if (!c.category || filter === "all") {
      map.addLayer(marker);
    } else if (c.category === filter) {
      map.addLayer(marker);
    } else {
      map.removeLayer(marker);
    }
  });
}

// ================= PROGRESS =================
function showProgress() {
  setPanelTitle("Progress");
  setBreadcrumb([{ label: "Progress" }]);

  const weakHtml = Object.keys(state.progress.weakAreas).length
    ? Object.entries(state.progress.weakAreas)
        .map(([k, v]) => `<li>${k}: ${v} wrong</li>`)
        .join("")
    : "<li>No weak areas recorded</li>";

  byId("content").innerHTML = `
    <div class="section-card">
      <p><b>Quizzes Played:</b> ${state.progress.quizzesPlayed}</p>
      <p><b>Correct Answers:</b> ${state.progress.correctAnswers}</p>
      <p><b>Wrong Answers:</b> ${state.progress.wrongAnswers}</p>
      <p><b>Weak Areas:</b></p>
      <ul>${weakHtml}</ul>
    </div>
  `;
}
const sheet = document.getElementById("bottomSheet");
const handle = document.querySelector(".sheet-handle");

const SHEET_STATES = {
  collapsed: 82,
  mid: 32,
  open: 8
};

let currentSheetState = "mid";
let dragStartY = 0;
let dragCurrentY = 0;
let draggingSheet = false;

function applySheetState(stateName) {
  currentSheetState = stateName;
  sheet.classList.remove("state-collapsed", "state-mid", "state-open");

  if (stateName === "collapsed") {
    sheet.classList.add("state-collapsed");
  } else if (stateName === "open") {
    sheet.classList.add("state-open");
  } else {
    sheet.classList.add("state-mid");
  }
}

function getCurrentTranslatePercent() {
  return SHEET_STATES[currentSheetState];
}

function startSheetDrag(clientY) {
  dragStartY = clientY;
  dragCurrentY = clientY;
  draggingSheet = true;
  sheet.style.transition = "none";
}

function moveSheetDrag(clientY) {
  if (!draggingSheet) return;

  dragCurrentY = clientY;
  const deltaY = dragCurrentY - dragStartY;
  const base = getCurrentTranslatePercent();
  const next = Math.max(8, Math.min(62, base + deltaY / 6));

  sheet.style.transform = `translateY(${next}%)`;
}

function endSheetDrag() {
  if (!draggingSheet) return;
  draggingSheet = false;
  sheet.style.transition = "transform 0.26s ease";

  const deltaY = dragCurrentY - dragStartY;

  if (deltaY < -50) {
    if (currentSheetState === "collapsed") {
      applySheetState("mid");
    } else if (currentSheetState === "mid") {
      applySheetState("open");
    } else {
      applySheetState("open");
    }
  } else if (deltaY > 50) {
    if (currentSheetState === "open") {
      applySheetState("mid");
    } else if (currentSheetState === "mid") {
      applySheetState("collapsed");
    } else {
      applySheetState("collapsed");
    }
  } else {
    applySheetState(currentSheetState);
  }
}

if (handle && sheet) {
  applySheetState("mid");

  handle.addEventListener("touchstart", (e) => {
    startSheetDrag(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!draggingSheet) return;
    moveSheetDrag(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener("touchend", () => {
    endSheetDrag();
  });

  handle.addEventListener("mousedown", (e) => {
    startSheetDrag(e.clientY);
  });

  window.addEventListener("mousemove", (e) => {
    if (!draggingSheet) return;
    moveSheetDrag(e.clientY);
  });

  window.addEventListener("mouseup", () => {
    endSheetDrag();
  });
}
function openSheetMid() {
  applySheetState("mid");
}

function openSheetFull() {
  applySheetState("open");
}
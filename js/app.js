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
  if (window.innerWidth <= 1024) {
    openSheetFull();
  } else {
    openSheetMid();
  }
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
// ================= PROGRESS =================
function showProgress() {
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

  localStorage.setItem("wineProgress", JSON.stringify(state.progress));
  showProgress();
}

const sheet = document.getElementById("bottomSheet");
const handle = document.querySelector(".sheet-handle");
const handleWrap = document.querySelector(".sheet-handle-wrap");
const sheetBody = document.getElementById("sheetBody");

const SHEET_STATES = {
  collapsed: 82,
  mid: 32,
  open: 8
};

let currentSheetState = "mid";
let dragStartY = 0;
let dragCurrentY = 0;
let dragStartTranslate = SHEET_STATES.mid;
let draggingSheet = false;
let dragSource = null; // "handle" | "content"

function applySheetState(stateName) {
  currentSheetState = stateName;
  sheet.classList.remove("state-collapsed", "state-mid", "state-open");
  sheet.classList.add(`state-${stateName}`);
  sheet.style.transform = "";

  if (stateName !== "open" && sheetBody) {
    sheetBody.scrollTop = 0;
  }

  refreshMapLayout();
}

function getCurrentTranslatePercent() {
  return SHEET_STATES[currentSheetState];
}

function setSheetTranslate(percent) {
  const clamped = Math.max(SHEET_STATES.open, Math.min(SHEET_STATES.collapsed, percent));
  sheet.style.transform = `translateY(${clamped}%)`;
}

function startSheetDrag(clientY, source = "handle") {
  dragStartY = clientY;
  dragCurrentY = clientY;
  dragStartTranslate = getCurrentTranslatePercent();
  draggingSheet = true;
  dragSource = source;
  sheet.style.transition = "none";
}

function moveSheetDrag(clientY) {
  if (!draggingSheet) return;

  dragCurrentY = clientY;
  const deltaY = dragCurrentY - dragStartY;

  const vh = window.innerHeight || 1;
  const deltaPercent = (deltaY / vh) * 100;
  const next = dragStartTranslate + deltaPercent;

  setSheetTranslate(next);
}

function endSheetDrag() {
  if (!draggingSheet) return;

  draggingSheet = false;
  sheet.style.transition = "transform 0.26s ease";

  const deltaY = dragCurrentY - dragStartY;
  const threshold = 60;

  if (deltaY <= -threshold) {
    if (currentSheetState === "collapsed") {
      applySheetState("mid");
    } else {
      applySheetState("open");
    }
  } else if (deltaY >= threshold) {
    if (currentSheetState === "open") {
      applySheetState("mid");
    } else {
      applySheetState("collapsed");
    }
  } else {
    applySheetState(currentSheetState);
  }

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

  // 2) Content 區：只有 scrollTop === 0 並且向下拉，先接管成 sheet drag
  sheetBody.addEventListener("touchstart", (e) => {
    dragStartY = e.touches[0].clientY;
    dragCurrentY = dragStartY;
  }, { passive: true });

  sheetBody.addEventListener("touchmove", (e) => {
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - dragStartY;
    const atTop = sheetBody.scrollTop <= 0;

    if (!draggingSheet && atTop && deltaY > 8 && currentSheetState !== "collapsed") {
      startSheetDrag(dragStartY, "content");
    }

    if (draggingSheet) {
      e.preventDefault();
      onPointerMove(currentY);
    }
  }, { passive: false });

  window.addEventListener("touchmove", (e) => {
    if (!draggingSheet || dragSource !== "handle") return;
    e.preventDefault();
    onPointerMove(e.touches[0].clientY);
  }, { passive: false });

  window.addEventListener("touchend", () => {
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

function openSheetFull() {
  applySheetState("open");
  resetSheetScroll();
  refreshMapLayout();
}
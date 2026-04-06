import { state } from "./state.js";
import { byId, debounce, loadJson, saveFavorites, parseFavorite } from "./utils.js";
import { setBreadcrumb, setPanelTitle } from "./ui.js";
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
}

init();

// ================= COUNTRY =================
async function showCountry(countryKey) {
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
        <p><b>Country:</b> ${country.name || "-"}</p>
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
        <p><b>Climate:</b> ${region.climate || "-"}</p>
        <p><b>Style:</b> ${region.styleSummary || "-"}</p>
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

    <div class="section-card">
      <p><b>Viticulture</b></p>
      <ul>${(grape.viticulture || []).map(x => `<li>${x}</li>`).join("")}</ul>
    </div>

    <div class="section-card">
      <p><b>Winemaking</b></p>
      <ul>${(grape.winemaking || []).map(x => `<li>${x}</li>`).join("")}</ul>
    </div>
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
async function searchAll(term) {
  const q = String(term || "").trim().toLowerCase();

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

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];

    if ((countryMeta.name || "").toLowerCase().includes(q)) {
      await showCountry(countryKey);
      return;
    }

    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      if ((region.name || "").toLowerCase().includes(q)) {
        await showRegion(countryKey, regionKey);
        return;
      }

      for (const grapeKey in (region.grapes || {})) {
        if (grapeKey.toLowerCase().includes(q)) {
          await showGrape(countryKey, regionKey, grapeKey);
          return;
        }
      }
    }
  }

  setPanelTitle("No result");
  setBreadcrumb([{ label: "Search" }, { label: q }]);
  byId("content").innerHTML = `
    <div class="section-card">
      <p>No country, region, or grape found for "<b>${q}</b>".</p>
    </div>
  `;
}

// ================= STYLE =================
async function showStyle(countryKey, styleKey) {
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
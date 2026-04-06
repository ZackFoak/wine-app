import { state } from "./state.js";
import { byId, debounce, loadJson, saveFavorites, parseFavorite, saveStudiedPages, isStudiedPage } from "./utils.js";
import { setBreadcrumb, setPanelTitle, showLoading } from "./ui.js";
import { startQuiz, buildGeneratedQuestions, startCustomQuiz } from "./quiz.js";

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

    const pageKey = `country::${country.name}`;

    let html = `
      <div class="section-card">
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          ${renderStudyButtons(pageKey)}
        </div>

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

    bindStudyButtons(pageKey, () => showCountry(countryKey));

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

    const pageKey = `region::${country.name}::${region.name || regionKey}`;

    let html = `
      <div class="section-card">
        <button class="btn secondary" id="backToCountry">← Back</button>
        <button class="btn secondary" id="quizThisRegionBtn">🧠 Quiz This Region</button>
        ${renderStudyButtons(pageKey)}

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

    bindStudyButtons(pageKey, () => showRegion(countryKey, regionKey));

    byId("backToCountry").onclick = () => showCountry(countryKey);

    document.querySelectorAll("[data-grape]").forEach(btn => {
      btn.addEventListener("click", () => showGrape(countryKey, regionKey, btn.dataset.grape));
    });

    document.querySelectorAll("[data-style]").forEach(btn => {
      btn.addEventListener("click", () => showStyle(countryKey, btn.dataset.style));
    });

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

  const pageKey = `grape::${country.name}::${country.regions[regionKey].name}::${grapeKey}`;

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
  
  byId("quizThisGrapeBtn").onclick = async () => {
    const questions = await buildQuizForGrape(
      grapeKey,
      grape,
      country.regions[regionKey].name,
      country.name
    );

    startCustomQuiz(questions, `Quiz: ${grapeKey}`);
  };

  bindStudyButtons(pageKey, () => showGrape(countryKey, regionKey, grapeKey));

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

      if (regionMatchReasons.length) {
        results.push({
          type: "region",
          label: `${region.name} (${country.name})`,
          matchReasons: regionMatchReasons,
          action: () => showRegion(countryKey, regionKey)
        });
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
  const regionResults = limitedResults.filter(r => r.type === "region");
  const grapeResults = limitedResults.filter(r => r.type === "grape");

  const orderedResults = [
    ...countryResults,
    ...regionResults,
    ...grapeResults
  ];

  let start = 0;
  const countryHtml = renderSearchGroup("Countries", countryResults, start);
  start += countryResults.length;

  const regionHtml = renderSearchGroup("Regions", regionResults, start);
  start += regionResults.length;

  const grapeHtml = renderSearchGroup("Grapes", grapeResults, start);

  byId("content").innerHTML = `
    ${countryHtml}
    ${regionHtml}
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

  if (region.climate) {
    questions.push({
      category: "climate",
      question: `What climate best describes ${region.name}?`,
      choices: buildChoices(region.climate, [
        "Continental",
        "Mediterranean",
        "Maritime",
        "Cool continental",
        "Warm Mediterranean"
      ]),
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
import { state } from "./state.js";
import { byId, loadJson, saveProgress } from "./utils.js";
import { setBreadcrumb, setPanelTitle } from "./ui.js";

export function startCustomQuiz(questions = [], title = "Custom Quiz") {
  state.quizScore = 0;
  state.quizCount = 0;
  state.weakAreas = {};
  state.quizPool = [...questions];
  state.quizMode = title;

  if (!state.quizPool.length) {
    setPanelTitle(title);
    byId("content").innerHTML = `
      <div class="section-card">
        <p>No quiz questions available for this selection yet.</p>
      </div>
    `;
    return;
  }

  startQuiz(false);
}

export function startQuiz(reset = false) {
  if (reset) {
    state.quizScore = 0;
    state.quizCount = 0;
    state.weakAreas = {};
    state.quizPool = [...state.quizQuestions, ...state.generatedQuestions];
    state.lastCategory = null;
  }

  if (state.quizCount >= state.quizTotal || state.quizPool.length === 0) {
    showQuizSummary();
    return;
  }

  const weightedPool = state.quizPool.flatMap(q => {
    // session weakness
    const sessionWeak = state.weakAreas[q.category] || 0;

    // long-term weakness
    const globalWeak = state.progress.weakAreas[q.category] || 0;

    // combine (調整權重比例)
    const weight = 1 + Math.min(sessionWeak, 2) + Math.min(globalWeak, 3);

    return Array(weight).fill(q);
  });

  let selected;

  for (let i = 0; i < 10; i++) {
    const candidate = weightedPool[Math.floor(Math.random() * weightedPool.length)];

    // 避免連續同 category
    if (candidate.category !== state.lastCategory) {
      selected = candidate;
      break;
    }
  }

  // fallback（如果真係避唔到）
  if (!selected) {
    selected = weightedPool[Math.floor(Math.random() * weightedPool.length)];
  }

  state.lastCategory = selected.category;
  const actualIndex = state.quizPool.findIndex(q =>
    q.question === selected.question && q.answer === selected.answer
  );

  state.currentQuiz = state.quizPool.splice(actualIndex, 1)[0];

  setPanelTitle(`Quiz Mode (${state.quizCount + 1}/${state.quizTotal})`);

  const panel = byId("content");
  let html = `
    <div class="section-card">
      <h3>${state.currentQuiz.question}</h3>
      <p><b>Category:</b> ${state.currentQuiz.category}</p>
      <p><b>Score:</b> ${state.quizScore} / ${state.quizCount}</p>
    </div>
  `;

  html += `<div class="section-card">`;
  state.currentQuiz.choices.forEach(choice => {
    html += `<button class="btn quiz-choice" data-choice="${choice}">${choice}</button>`;
  });
  html += `<div id="quizResult" style="margin-top:15px;"></div></div>`;

  panel.innerHTML = html;

  document.querySelectorAll(".quiz-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      checkQuizAnswer(btn.dataset.choice);
    });
  });
}

export function checkQuizAnswer(choice) {
  const result = byId("quizResult");
  if (!state.currentQuiz) return;

  document.querySelectorAll(".quiz-choice").forEach(btn => btn.disabled = true);

  state.quizCount++;

  if (choice === state.currentQuiz.answer) {
    state.quizScore++;
    state.progress.correctAnswers++;
    result.innerHTML = `<span class="quiz-result-good">✅ Correct!</span>`;
  } else {
    state.progress.wrongAnswers++;
    result.innerHTML = `<span class="quiz-result-bad">❌ Wrong! Correct: ${state.currentQuiz.answer}</span>`;

    if (!state.weakAreas[state.currentQuiz.category]) {
      state.weakAreas[state.currentQuiz.category] = 0;
    }
    state.weakAreas[state.currentQuiz.category]++;

    if (!state.progress.weakAreas[state.currentQuiz.category]) {
      state.progress.weakAreas[state.currentQuiz.category] = 0;
    }
    state.progress.weakAreas[state.currentQuiz.category]++;
  }

  saveProgress();

  if (state.currentQuiz.explanation) {
    result.innerHTML += `<br><br>${state.currentQuiz.explanation}`;
  }

  if (state.quizCount < state.quizTotal) {
    result.innerHTML += `<br><br><button class="btn" id="nextQuizBtn">Next</button>`;
    byId("nextQuizBtn").onclick = () => startQuiz();
  } else {
    result.innerHTML += `<br><br><button class="btn" id="finishQuizBtn">Result</button>`;
    byId("finishQuizBtn").onclick = () => showQuizSummary();
  }
}

export function showQuizSummary() {
  const percentage = Math.round((state.quizScore / state.quizTotal) * 100);

  const weakHtml = Object.keys(state.weakAreas).length
    ? Object.entries(state.weakAreas)
        .map(([k, v]) => `<li>${k}: ${v} wrong</li>`)
        .join("")
    : "<li>No weak areas recorded</li>";

  setPanelTitle("Quiz Result");

  byId("content").innerHTML = `
    <div class="section-card">
      <h3>Finished</h3>
      <p><b>Score:</b> ${state.quizScore}/${state.quizTotal}</p>
      <p><b>Percentage:</b> ${percentage}%</p>
      <p><b>Weak Areas:</b></p>
      <ul>${weakHtml}</ul>
      <button class="btn" id="restartQuizBtn">Restart</button>
    </div>
  `;

  byId("restartQuizBtn").onclick = () => startQuiz(true);

  state.progress.quizzesPlayed++;
  saveProgress();
}

export async function buildGeneratedQuestions() {
  const questions = [];

  const allGrapes = [];
  const allRegions = [];
  const allCountryStyles = [];

  // ---------- pass 1: collect global pools ----------
  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      allRegions.push({
        countryKey,
        countryName: country.name,
        regionKey,
        regionName: region.name || regionKey,
        climate: region.climate || "",
        styleSummary: region.styleSummary || "",
        keyGrapes: region.keyGrapes || []
      });

      for (const grapeKey in (region.grapes || {})) {
        const grape = region.grapes[grapeKey];

        allGrapes.push({
          countryKey,
          countryName: country.name,
          regionKey,
          regionName: region.name || regionKey,
          grapeKey,
          style: grape.style || "",
          summary: grape.summary || "",
          aliases: grape.aliases || [],
          aromas: grape.aromas || [],
          viticulture: grape.viticulture || [],
          winemaking: grape.winemaking || [],
          pairing: grape.pairing || [],
          examTips: grape.examTips || [],
          tags: grape.tags || [],
          profile: grape.profile || {}
        });
      }
    }

    for (const styleKey in (country.styles || {})) {
      const style = country.styles[styleKey];
      allCountryStyles.push({
        countryKey,
        countryName: country.name,
        styleKey,
        name: style.name || styleKey,
        style: style.style || "",
        aging: style.aging || "",
        keyPoint: style.keyPoint || ""
      });
    }
  }

  // ---------- pass 2: build questions ----------
  for (const region of allRegions) {
    // 1. region climate
    if (region.climate) {
      questions.push({
        category: "climate",
        question: `What is the climate of ${region.regionName}?`,
        choices: buildOptions(
          region.climate,
          pickDistinctValues(
            allRegions.map(r => r.climate).filter(Boolean),
            region.climate,
            3
          )
        ),
        answer: region.climate,
        explanation: `${region.regionName} is typically described as ${region.climate}.`
      });
    }

    // 2. region style summary
    if (region.styleSummary) {
      questions.push({
        category: "region style",
        question: `Which description best matches ${region.regionName}?`,
        choices: buildOptions(
          region.styleSummary,
          pickDistinctValues(
            allRegions.map(r => r.styleSummary).filter(Boolean),
            region.styleSummary,
            3
          )
        ),
        answer: region.styleSummary,
        explanation: `${region.regionName}: ${region.styleSummary}`
      });
    }

    // 3. region -> key grape
    if (region.keyGrapes.length) {
      const correct = region.keyGrapes[0];
      questions.push({
        category: "key grape",
        question: `Which grape is a key grape of ${region.regionName}?`,
        choices: buildOptions(
          correct,
          pickDistinctValues(
            allGrapes.map(g => g.grapeKey),
            correct,
            3
          )
        ),
        answer: correct,
        explanation: `${correct} is one of the key grapes of ${region.regionName}.`
      });
    }
  }

  for (const grape of allGrapes) {
    // 4. grape associated with region
    questions.push({
      category: "grape",
      question: `Which grape is associated with ${grape.regionName}?`,
      choices: buildOptions(
        grape.grapeKey,
        pickDistinctValues(
          allGrapes.map(g => g.grapeKey),
          grape.grapeKey,
          3
        )
      ),
      answer: grape.grapeKey,
      explanation: `${grape.grapeKey} is a key grape in ${grape.regionName}.`
    });

    // 5. grape style
    if (grape.style) {
      questions.push({
        category: "style",
        question: `Which description best matches ${grape.grapeKey}?`,
        choices: buildOptions(
          grape.style,
          pickDistinctValues(
            allGrapes.map(g => g.style).filter(Boolean),
            grape.style,
            3
          )
        ),
        answer: grape.style,
        explanation: grape.style
      });
    }

    // 6. aroma
    if (grape.aromas.length) {
      const correctAroma = grape.aromas[0];
      questions.push({
        category: "aroma",
        question: `Which aroma is commonly associated with ${grape.grapeKey}?`,
        choices: buildOptions(
          correctAroma,
          pickDistinctValues(
            allGrapes.flatMap(g => g.aromas || []).filter(Boolean),
            correctAroma,
            3
          )
        ),
        answer: correctAroma,
        explanation: `${grape.grapeKey} is commonly linked with aromas such as ${grape.aromas.join(", ")}.`
      });
    }

    // 7. alias
    if (grape.aliases.length) {
      const correctAlias = grape.aliases[0];
      questions.push({
        category: "alias",
        question: `Which is an alias of ${grape.grapeKey}?`,
        choices: buildOptions(
          correctAlias,
          pickDistinctValues(
            allGrapes.flatMap(g => g.aliases || []).filter(Boolean),
            correctAlias,
            3
          )
        ),
        answer: correctAlias,
        explanation: `${correctAlias} is listed as an alias of ${grape.grapeKey}.`
      });
    }

    // 8. body
    if (grape.profile?.body) {
      questions.push({
        category: "body",
        question: `What body level is typical for ${grape.grapeKey}?`,
        choices: buildOptions(
          grape.profile.body,
          pickDistinctValues(
            allGrapes.map(g => g.profile?.body).filter(Boolean),
            grape.profile.body,
            3
          )
        ),
        answer: grape.profile.body,
        explanation: `${grape.grapeKey} is typically described as ${grape.profile.body} in body.`
      });
    }

    // 9. acidity
    if (grape.profile?.acidity) {
      questions.push({
        category: "acidity",
        question: `What acidity level is typical for ${grape.grapeKey}?`,
        choices: buildOptions(
          grape.profile.acidity,
          pickDistinctValues(
            allGrapes.map(g => g.profile?.acidity).filter(Boolean),
            grape.profile.acidity,
            3
          )
        ),
        answer: grape.profile.acidity,
        explanation: `${grape.grapeKey} is typically described as ${grape.profile.acidity} in acidity.`
      });
    }

    // 10. tannin
    if (grape.profile?.tannin) {
      questions.push({
        category: "tannin",
        question: `What tannin level is typical for ${grape.grapeKey}?`,
        choices: buildOptions(
          grape.profile.tannin,
          pickDistinctValues(
            allGrapes.map(g => g.profile?.tannin).filter(Boolean),
            grape.profile.tannin,
            3
          )
        ),
        answer: grape.profile.tannin,
        explanation: `${grape.grapeKey} is typically described as ${grape.profile.tannin} in tannin.`
      });
    }

    // 11. alcohol
    if (grape.profile?.alcohol) {
      questions.push({
        category: "alcohol",
        question: `What alcohol level is typical for ${grape.grapeKey}?`,
        choices: buildOptions(
          grape.profile.alcohol,
          pickDistinctValues(
            allGrapes.map(g => g.profile?.alcohol).filter(Boolean),
            grape.profile.alcohol,
            3
          )
        ),
        answer: grape.profile.alcohol,
        explanation: `${grape.grapeKey} is typically described as ${grape.profile.alcohol} in alcohol.`
      });
    }

    // 12. food pairing
    if (grape.pairing.length) {
      const correctPairing = grape.pairing[0];
      questions.push({
        category: "pairing",
        question: `Which food pairing works well with ${grape.grapeKey}?`,
        choices: buildOptions(
          correctPairing,
          pickDistinctValues(
            allGrapes.flatMap(g => g.pairing || []).filter(Boolean),
            correctPairing,
            3
          )
        ),
        answer: correctPairing,
        explanation: `${grape.grapeKey} pairs well with foods such as ${grape.pairing.join(", ")}.`
      });
    }
  }

  for (const styleItem of allCountryStyles) {
    // 13. country style key point
    if (styleItem.keyPoint) {
      questions.push({
        category: "fortified/sparkling style",
        question: `Which statement best matches ${styleItem.name}?`,
        choices: buildOptions(
          styleItem.keyPoint,
          pickDistinctValues(
            allCountryStyles.map(s => s.keyPoint).filter(Boolean),
            styleItem.keyPoint,
            3
          )
        ),
        answer: styleItem.keyPoint,
        explanation: `${styleItem.name}: ${styleItem.keyPoint}`
      });
    }

    // 14. style belongs to country
    if (styleItem.name) {
      questions.push({
        category: "style origin",
        question: `${styleItem.name} belongs to which country section in your atlas?`,
        choices: buildOptions(
          styleItem.countryName,
          pickDistinctValues(
            Object.values(state.countriesData).map(c => c.name).filter(Boolean),
            styleItem.countryName,
            3
          )
        ),
        answer: styleItem.countryName,
        explanation: `${styleItem.name} is grouped under ${styleItem.countryName} in your atlas data.`
      });
    }
  }

  state.generatedQuestions = dedupeQuestions(questions);
}

function pickDistinctValues(source, correct, count = 3) {
  const unique = [...new Set(source.map(x => String(x).trim()).filter(Boolean))];
  const filtered = unique.filter(x => x !== String(correct).trim());

  return shuffleArray(filtered).slice(0, count);
}

function buildOptions(correct, distractors = []) {
  const options = [correct, ...distractors].filter(Boolean);
  return shuffleArray([...new Set(options)]).slice(0, 4);
}

function dedupeQuestions(questions) {
  const seen = new Set();

  return questions.filter(q => {
    const key = `${q.category}__${q.question}__${q.answer}`;
    if (seen.has(key)) return false;
    seen.add(key);

    return Array.isArray(q.choices) && q.choices.length >= 2;
  });
}

function shuffleArray(arr) {
  const cloned = [...arr];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function filterQuizPool(pool, mode) {
  if (mode === "all") return pool;

  const categoryMap = {
    grapes: ["grape", "alias", "aroma", "pairing"],
    regions: ["climate", "region style", "key grape"],
    profiles: ["body", "acidity", "tannin", "alcohol"],
    styles: ["style", "fortified/sparkling style", "style origin"],
    weak: null
  };

  if (mode === "weak") {
    return pool.filter(q => state.progress.weakAreas[q.category]);
  }

  const allowed = categoryMap[mode];
  if (!allowed) return pool;

  return pool.filter(q => allowed.includes(q.category));
}

function shuffleChoices(choices, correct) {
  return buildOptions(correct, choices.filter(x => x !== correct));
}
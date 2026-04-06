import { state } from "./state.js";
import { byId, loadJson, saveProgress } from "./utils.js";
import { setBreadcrumb, setPanelTitle } from "./ui.js";

export function startQuiz(reset = false) {
  if (reset) {
    state.quizScore = 0;
    state.quizCount = 0;
    state.weakAreas = {};
    state.quizPool = [...state.quizQuestions, ...state.generatedQuestions];
  }

  if (state.quizCount >= state.quizTotal || state.quizPool.length === 0) {
    showQuizSummary();
    return;
  }

  const weightedPool = state.quizPool.flatMap(q => {
    const weakCount = state.weakAreas[q.category] || 0;
    const extraWeight = Math.min(weakCount, 3);
    return Array(1 + extraWeight).fill(q);
  });

  const selected = weightedPool[Math.floor(Math.random() * weightedPool.length)];
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

  for (const countryKey in state.countriesData) {
    const countryMeta = state.countriesData[countryKey];
    const country = await loadJson(`./data/${countryMeta.file}`);

    for (const regionKey in (country.regions || {})) {
      const region = country.regions[regionKey];

      if (region.climate) {
        questions.push({
          category: "climate",
          question: `What is the climate of ${region.name}?`,
          choices: shuffleChoices([
            region.climate,
            "Maritime",
            "Continental",
            "Mediterranean",
            "Cool continental",
            "Warm Mediterranean"
          ], region.climate),
          answer: region.climate,
          explanation: `${region.name} is typically described as ${region.climate}.`
        });
      }

      for (const grapeKey in (region.grapes || {})) {
        questions.push({
          category: "grape",
          question: `Which grape is associated with ${region.name}?`,
          choices: shuffleChoices([
            grapeKey,
            "Cabernet Sauvignon",
            "Chardonnay",
            "Riesling",
            "Sangiovese",
            "Tempranillo"
          ], grapeKey),
          answer: grapeKey,
          explanation: `${grapeKey} is a key grape in ${region.name}.`
        });

        const grape = region.grapes[grapeKey];
        if (grape.style) {
          questions.push({
            category: "style",
            question: `Which description best matches ${grapeKey}?`,
            choices: shuffleChoices([
              grape.style,
              "Fresh citrus and low alcohol",
              "Deep colour and very low tannin",
              "Neutral flavour and no acidity",
              "Sweet raisin and molasses"
            ], grape.style),
            answer: grape.style,
            explanation: grape.style
          });
        }
      }
    }

    for (const styleKey in (country.styles || {})) {
      const style = country.styles[styleKey];
      questions.push({
        category: "fortified/sparkling style",
        question: `Which statement best matches ${style.name}?`,
        choices: shuffleChoices([
          style.keyPoint,
          "Tank method only",
          "No fortification used",
          "Always sweet and low acid",
          "Made only from Pinot Noir"
        ], style.keyPoint),
        answer: style.keyPoint,
        explanation: `${style.name}: ${style.keyPoint}`
      });
    }
  }

  state.generatedQuestions = questions;
}

function shuffleChoices(choices, correct) {
  const unique = [...new Set(choices)].filter(Boolean);
  const trimmed = unique.slice(0, 4);

  if (!trimmed.includes(correct)) {
    trimmed.pop();
    trimmed.push(correct);
  }

  return trimmed.sort(() => Math.random() - 0.5);
}
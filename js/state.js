export const state = {
  currentFilter: "all",
  markers: {},
  countriesData: null,
  quizQuestions: [],
  generatedQuestions: [],
  currentQuiz: null,
  quizScore: 0,
  quizCount: 0,
  quizTotal: 10,
  quizPool: [],
  weakAreas: {},
  favorites: JSON.parse(localStorage.getItem("wineFavorites") || "[]"),
  progress: JSON.parse(localStorage.getItem("wineProgress") || JSON.stringify({
    quizzesPlayed: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    weakAreas: {}
  })),
  dataCache: new Map()
};
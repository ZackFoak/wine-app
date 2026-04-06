import { state } from "./state.js";

export function byId(id) {
  return document.getElementById(id);
}

export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function saveFavorites() {
  localStorage.setItem("wineFavorites", JSON.stringify(state.favorites));
}

export function saveProgress() {
  localStorage.setItem("wineProgress", JSON.stringify(state.progress));
}

export function parseFavorite(item) {
  const parts = item.split(" > ");
  return {
    country: parts[0],
    region: parts[1],
    grape: parts[2]
  };
}

export async function loadJson(path) {
  try {
    if (state.dataCache.has(path)) {
      return state.dataCache.get(path);
    }

    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);

    const json = await res.json();
    state.dataCache.set(path, json);
    return json;
  } catch (e) {
    console.error(e);
    return {};
  }
}

export function saveStudiedPages() {
  localStorage.setItem("wineStudiedPages", JSON.stringify(state.studiedPages));
}

export function isStudiedPage(key) {
  return state.studiedPages.includes(key);
}
import { byId } from "./utils.js";

export function setBreadcrumb(items) {
  const el = byId("breadcrumb");

  el.innerHTML = items.map((item, index) => {
    if (item.click) {
      return `<span class="breadcrumb-link" data-bc="${index}">${item.label}</span>`;
    }
    return `<span>${item.label}</span>`;
  }).join(" <span class='breadcrumb-sep'>›</span> ");

  items.forEach((item, index) => {
    if (item.click) {
      document.querySelector(`[data-bc="${index}"]`)?.addEventListener("click", item.click);
    }
  });
}

export function setPanelTitle(text) {
  byId("title").innerText = text;
}

export function showLoading(message = "Loading...") {
  byId("content").innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-text">${message}</div>
    </div>
  `;
}
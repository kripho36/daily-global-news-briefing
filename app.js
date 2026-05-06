const dateList = document.querySelector("#dateList");
const updatedAt = document.querySelector("#updatedAt");
const briefingTitle = document.querySelector("#briefingTitle");
const briefingSource = document.querySelector("#briefingSource");
const rawJsonLink = document.querySelector("#rawJsonLink");
const summary = document.querySelector("#summary");
const sections = document.querySelector("#sections");

const SOURCE_LABELS = {
  Reuters: "Reuters",
  AP: "AP News",
  BBC: "BBC",
  NYT: "The New York Times"
};

init().catch((error) => {
  renderError("브리핑을 불러오지 못했습니다.", error);
});

async function init() {
  const index = await fetchJson("data/index.json");
  const dates = index.dates ?? [];

  if (dates.length === 0) {
    updatedAt.textContent = "아직 생성된 브리핑 없음";
    briefingTitle.textContent = "첫 브리핑 생성 대기 중";
    summary.innerHTML = '<div class="empty">GitHub Actions가 실행되면 이곳에 매일 07:00 브리핑이 쌓입니다.</div>';
    return;
  }

  renderDates(dates);
  const requestedDate = new URLSearchParams(location.search).get("date");
  await loadBriefing(dates.includes(requestedDate) ? requestedDate : dates[0]);
}

function renderDates(dates) {
  dateList.innerHTML = "";
  for (const date of dates) {
    const button = document.createElement("button");
    button.className = "date-button";
    button.type = "button";
    button.textContent = date;
    button.addEventListener("click", () => loadBriefing(date));
    dateList.append(button);
  }
}

async function loadBriefing(date) {
  const briefing = await fetchJson(`data/${date}.json`);
  history.replaceState(null, "", `?date=${date}`);

  document.querySelectorAll(".date-button").forEach((button) => {
    button.setAttribute("aria-current", button.textContent === date ? "true" : "false");
  });

  updatedAt.textContent = `최근 업데이트 ${briefing.generatedAtKst ?? date}`;
  briefingSource.textContent = (briefing.sources ?? []).map((source) => SOURCE_LABELS[source] ?? source).join(" · ");
  briefingTitle.textContent = briefing.title ?? `${date} 국제 정세 브리핑`;
  rawJsonLink.href = `data/${date}.json`;

  summary.innerHTML = `
    <h3>뉴스 요약본</h3>
    <p>${escapeHtml(briefing.overallSummary ?? "")}</p>
  `;

  sections.innerHTML = "";
  for (const section of briefing.sections ?? []) {
    const sectionElement = document.createElement("section");
    sectionElement.className = "news-section";
    sectionElement.innerHTML = `
      <h3>${escapeHtml(section.heading)}</h3>
      <div class="items">
        ${(section.items ?? []).map(renderItem).join("")}
      </div>
    `;
    sections.append(sectionElement);
  }
}

function renderItem(item) {
  const stars = "★".repeat(item.importance ?? 3) + "☆".repeat(5 - (item.importance ?? 3));
  return `
    <article class="news-item">
      <div class="item-title">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="stars" aria-label="중요도 ${item.importance}점">${stars}</span>
      </div>
      <a class="source" href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">
        원본 뉴스: ${escapeHtml(item.source)} - ${escapeHtml(item.originalTitle ?? item.title)}
      </a>
      <p class="body"><span class="label">내용:</span> ${escapeHtml(item.content)}</p>
      <p class="impact"><span class="label">영향:</span> ${escapeHtml(item.impact)}</p>
    </article>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} ${response.status}`);
  }
  return response.json();
}

function renderError(message, error) {
  updatedAt.textContent = "오류";
  briefingTitle.textContent = message;
  summary.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const MAX_ARTICLES = Number(process.env.MAX_ARTICLES ?? 36);
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";

const SOURCES = [
  {
    source: "Reuters",
    type: "page",
    urls: [
      "https://www.reuters.com/world/",
      "https://www.reuters.com/world/us/",
      "https://www.reuters.com/business/",
      "https://www.reuters.com/technology/"
    ]
  },
  {
    source: "AP",
    type: "rss",
    urls: [
      "https://apnews.com/hub/ap-top-news?output=rss",
      "https://apnews.com/hub/world-news?output=rss",
      "https://apnews.com/hub/politics?output=rss"
    ]
  },
  {
    source: "BBC",
    type: "rss",
    urls: [
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://feeds.bbci.co.uk/news/technology/rss.xml",
      "https://feeds.bbci.co.uk/news/business/rss.xml"
    ]
  },
  {
    source: "NYT",
    type: "rss",
    urls: [
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"
    ]
  }
];

const now = new Date();
const dateKst = formatKstDate(now);
const generatedAtKst = formatKstDateTime(now);

await mkdir(DATA_DIR, { recursive: true });

const articles = await collectArticles();
if (articles.length === 0) {
  throw new Error("No source articles were collected. Check RSS source availability.");
}

const briefing = await createBriefing(articles);
briefing.date = dateKst;
briefing.generatedAtKst = generatedAtKst;
briefing.sources = [...new Set(articles.map((article) => article.source))];

await writeFile(path.join(DATA_DIR, `${dateKst}.json`), `${JSON.stringify(briefing, null, 2)}\n`, "utf8");
await updateIndex(dateKst);

console.log(`Created briefing for ${dateKst} with ${articles.length} candidate articles.`);

async function collectArticles() {
  const collected = [];
  const seen = new Set();

  for (const feed of SOURCES) {
    for (const url of feed.urls) {
      try {
        const body = await fetchText(url);
        const items = feed.type === "page" ? parseReutersPage(body, url) : parseRss(body, feed.source);
        for (const item of items) {
          const key = normalizeUrl(item.url) || `${item.source}:${item.title}`;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          collected.push(item);
        }
      } catch (error) {
        console.warn(`Skipped ${feed.source} feed: ${url} (${error.message})`);
      }
    }
  }

  return collected
    .filter((article) => article.title && article.url)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_ARTICLES);
}

async function createBriefing(articles) {
  if (!process.env.GROQ_API_KEY) {
    return createFallbackBriefing(articles);
  }

  const prompt = buildPrompt(articles);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a Korean geopolitical news editor. Use only the supplied source articles. Do not invent facts. Return valid JSON only."
        },
        { role: "user", content: prompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "daily_global_news_briefing",
          strict: true,
          schema: briefingSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq API failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Groq API response did not include message content.");
  }

  return JSON.parse(text);
}

function buildPrompt(articles) {
  const articleText = articles
    .map((article, index) => {
      return [
        `[${index + 1}] ${article.source}`,
        `title: ${article.title}`,
        `url: ${article.url}`,
        `publishedAt: ${article.publishedAt || "unknown"}`,
        `summary: ${article.description || ""}`
      ].join("\n");
    })
    .join("\n\n");

  return `
한국시간 ${dateKst} 오전 7시에 공개될 국제 정세 뉴스 브리핑을 작성해줘.

요구사항:
- Reuters, AP, BBC, The New York Times 기사 후보만 사용한다.
- 전날과 오늘 아침의 중요 사건을 우선한다.
- 분야는 테크/IT, 미국 정세, 정치, 금융, 한국, 세계 주요 사건/사고를 포함한다.
- 독자가 외부인이라고 가정하고, 배경과 영향까지 알 수 있게 한국어로 자세히 쓴다.
- 중요도는 1~5 정수이며 5가 가장 중요하다.
- 전체 항목은 중요도 순으로 정렬하되, 섹션은 읽기 좋게 묶는다.
- 각 항목의 url은 반드시 제공된 기사 URL 중 하나를 그대로 사용한다.
- 기사 후보에 없는 내용, 수치, 발언, 작전명은 절대 만들지 않는다.
- 제목은 한국어로 쓰되, originalTitle에는 원문 제목을 넣는다.
- overallSummary는 오늘 전체 흐름을 하나의 한국어 브리핑 문단으로 쓴다.

기사 후보:
${articleText}
`;
}

function briefingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "overallSummary", "sections"],
    properties: {
      title: { type: "string" },
      overallSummary: { type: "string" },
      sections: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "items"],
          properties: {
            heading: { type: "string" },
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "importance", "source", "url", "originalTitle", "content", "impact"],
                properties: {
                  title: { type: "string" },
                  importance: { type: "integer", minimum: 1, maximum: 5 },
                  source: { type: "string", enum: ["Reuters", "AP", "BBC", "NYT"] },
                  url: { type: "string" },
                  originalTitle: { type: "string" },
                  content: { type: "string" },
                  impact: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createFallbackBriefing(articles) {
  const items = articles.slice(0, 10).map((article, index) => ({
    title: article.title,
    importance: index < 3 ? 4 : 3,
    source: article.source,
    url: article.url,
    originalTitle: article.title,
    content: article.description || "AI 요약을 사용하려면 GitHub Secrets에 GROQ_API_KEY를 설정하세요.",
    impact: "원문 확인이 필요합니다. 현재 파일은 API 키가 없을 때 생성되는 임시 목록입니다."
  }));

  return {
    title: `${dateKst} 국제 정세 브리핑`,
    overallSummary:
      "아직 AI 요약 API 키가 설정되지 않아, 신뢰 가능한 원문 기사 후보 목록만 정리했습니다. GitHub Secrets에 GROQ_API_KEY를 추가하면 다음 실행부터 한국어 요약과 영향 분석이 자동 생성됩니다.",
    sections: [{ heading: "🗞️ 원문 기사 후보", items }]
  };
}

async function updateIndex(date) {
  const indexPath = path.join(DATA_DIR, "index.json");
  let dates = [];

  try {
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    dates = Array.isArray(index.dates) ? index.dates : [];
  } catch {
    dates = [];
  }

  dates = [date, ...dates.filter((item) => item !== date)].sort().reverse();
  await writeFile(indexPath, `${JSON.stringify({ dates }, null, 2)}\n`, "utf8");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "DailyGlobalNewsBriefing/1.0 (+https://github.com)"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0];
    return {
      source,
      title: cleanXml(readTag(item, "title")),
      url: cleanXml(readTag(item, "link")) || cleanXml(readTag(item, "guid")),
      publishedAt: cleanXml(readTag(item, "pubDate") || readTag(item, "dc:date") || readTag(item, "updated")),
      description: cleanXml(readTag(item, "description"))
    };
  });
}

function parseReutersPage(html, pageUrl) {
  const found = new Map();

  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = cleanXml(match[1]);
    const title = cleanXml(match[2]);
    if (!title || title.length < 18) continue;
    if (!href.includes("/world/") && !href.includes("/business/") && !href.includes("/technology/")) continue;

    const url = new URL(href, pageUrl).toString();
    if (!url.includes("reuters.com")) continue;
    if (!found.has(url)) {
      found.set(url, {
        source: "Reuters",
        title,
        url,
        publishedAt: "",
        description: ""
      });
    }
  }

  return [...found.values()].slice(0, 18);
}

function readTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ?? "";
}

function cleanXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_")) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function formatKstDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatKstDateTime(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

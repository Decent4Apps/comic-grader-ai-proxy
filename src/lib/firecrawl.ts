// src/lib/firecrawl.ts
// Lightweight Firecrawl client + eBay sold-page parsing + stats helpers.

export const FIRECRAWL_BASE_URL =
  process.env.FIRECRAWL_BASE_URL?.replace(/\/+$/, "") || "https://api.firecrawl.dev";

const API_KEY = process.env.FIRECRAWL_API_KEY || "";
const DEFAULT_SEARCH_LIMIT = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6);
export const DEFAULT_SCRAPE_CONCURRENCY = Number(process.env.FIRECRAWL_SCRAPE_CONCURRENCY || 3);

// --- gzip-safe fetch with timeout ---
export async function fFetch<T = any>(
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s

  try {
    const res = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${API_KEY}`,
        "accept-encoding": "gzip, deflate, br",
        ...(options.headers || {}),
      },
      signal: options.signal ?? controller.signal,
      // Next/Node fetch handles gzip/deflate automatically on server
    });

    const text = await res.text();
    const data = (() => {
      try { return JSON.parse(text); } catch { return text as any; }
    })();

    if (!res.ok) {
      throw new Error(
        `Firecrawl ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
      );
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Public helpers ---

export type SearchResult = {
  url: string;
  title?: string;
  snippet?: string;
};

export async function firecrawlSearch(query: string, limit = DEFAULT_SEARCH_LIMIT) {
  type SearchResp = { data?: Array<{ url: string; title?: string; snippet?: string }> };
  const body = JSON.stringify({ query, limit });
  const res = await fFetch<SearchResp>("/v1/search", { method: "POST", body });
  const results = (res?.data || []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
  })) as SearchResult[];
  return results;
}

export async function firecrawlScrape(url: string) {
  type ScrapeResp = {
    url: string;
    markdown?: string;
    html?: string;
    error?: string;
  };
  const body = JSON.stringify({ url, formats: ["markdown"] });
  return await fFetch<ScrapeResp>("/v1/scrape", { method: "POST", body });
}

// --- Parsing eBay sold pages ---
export type ParsedSale = {
  url: string;
  title?: string;
  price?: number;
  currency?: string;
  gradeDetected?: string;
  dateText?: string;
};

const PRICE_RE = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g; // $1,234.56 or 1234.56
const USD_CURRENCY_HINT = /\$|USD|US\s*\$/i;
const GRADE_RE = /\bCGC\s*([0-9]\.[0-9]|10(?:\.0)?)\b/i;
// Loose date patterns from eBay sold/ended sections
const DATE_RE =
  /\b(Sold|Ended|Completed|Date|On)\s*(on|:)?\s*([A-Za-z]{3,}\s*\d{1,2},?\s*\d{2,4}|\d{1,2}[\/\-][A-Za-z]{3}[\/\-]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;

export function parseSaleFromMarkdown(
  url: string,
  title: string | undefined,
  md: string,
  fallbackCurrency = "USD"
): ParsedSale {
  let price: number | undefined;
  let currency: string | undefined;
  let gradeDetected: string | undefined;
  let dateText: string | undefined;

  const lines = md.split(/\r?\n/);

  for (const line of lines) {
    if (!price) {
      PRICE_RE.lastIndex = 0;
      const m = PRICE_RE.exec(line);
      if (m) {
        const val = Number(m[1].replace(/,/g, ""));
        if (!Number.isNaN(val) && val > 0) {
          price = val;
          currency = USD_CURRENCY_HINT.test(line) ? "USD" : undefined;
        }
      }
    }
    if (!gradeDetected) {
      const gm = GRADE_RE.exec(line);
      if (gm) gradeDetected = `CGC ${gm[1]}`;
    }
    if (!dateText) {
      const dm = DATE_RE.exec(line);
      if (dm) dateText = dm[0];
    }
    if (price && gradeDetected && dateText) break;
  }

  if (!currency) currency = fallbackCurrency;

  return { url, title, price, currency, gradeDetected, dateText };
}

export function computeStats(sales: ParsedSale[]) {
  const prices = sales
    .map((s) => s.price)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

  if (prices.length === 0) {
    return { count: 0, avg: null, median: null, min: null, max: null, currency: "USD" as const };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const currencyCounts = new Map<string, number>();
  for (const s of sales) {
    const c = (s.currency || "USD").toUpperCase();
    currencyCounts.set(c, (currencyCounts.get(c) || 0) + 1);
  }
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";

  return {
    count: prices.length,
    avg: +(sum / sorted.length).toFixed(2),
    median: +median.toFixed(2),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    currency,
  };
}

export function buildEbaySoldQuery(input: {
  title?: string;
  issue?: string | number;
  grade?: string | number;
  site?: string;         // default ebay.com
}) {
  const site = (input.site || "ebay.com").replace(/^site:/i, "");
  const parts: string[] = [];
  if (input.title) parts.push(`"${input.title}"`);
  if (input.issue) parts.push(`"#${String(input.issue)}"`);
  if (input.grade !== undefined && input.grade !== null && input.grade !== "") {
    parts.push(`"CGC ${String(input.grade).trim()}"`);
  }
  parts.push("sold");
  return `site:${site} ${parts.join(" ")}`.trim();
}

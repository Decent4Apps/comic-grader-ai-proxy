// src/lib/firecrawl.ts - Firecrawl v2 SDK
import Firecrawl from 'firecrawl';

const API_KEY = process.env.FIRECRAWL_API_KEY || "";
const DEFAULT_SEARCH_LIMIT = Number(process.env.FIRECRAWL_SEARCH_LIMIT || 6);

// Initialize Firecrawl v2 client (singleton pattern for performance)
let firecrawlClient: Firecrawl | null = null;

function getFirecrawl() {
  if (!firecrawlClient && API_KEY) {
    firecrawlClient = new Firecrawl({ apiKey: API_KEY });
  }
  return firecrawlClient;
}

export type SearchResult = {
  url: string;
  title?: string;
  snippet?: string;
  markdown?: string;
};

// v2: Search with scrapeOptions in ONE call (much faster than v1!)
export async function firecrawlSearchWithScrape(
  query: string, 
  limit = DEFAULT_SEARCH_LIMIT
): Promise<SearchResult[]> {
  const client = getFirecrawl();
  if (!client) {
    throw new Error('Firecrawl API key not configured');
  }

  try {
    const result = await client.search(query, {
      limit,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
        excludeTags: ['nav', 'footer', 'header', 'ads'],
        waitFor: 3000,
      }
    });

    if (!result.web || result.web.length === 0) {
      console.warn('[Firecrawl v4] Search returned no results');
      return [];
    }

    return result.web.map((item: any) => ({
      url: item.url,
      title: item.title,
      snippet: item.description,
      markdown: item.markdown
    }));
  } catch (error: any) {
    console.error('[Firecrawl v2] Search error:', error.message);
    throw error;
  }
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

const PRICE_RE = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
const USD_CURRENCY_HINT = /\$|USD|US\s*\$/i;
const GRADE_RE = /\bCGC\s*([0-9]\.[0-9]|10(?:\.0)?)\b/i;
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

  // Look for sold price specifically (more accurate)
  const soldPricePatterns = [
    /sold.*?\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
    /price.*?\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  ];

  for (const line of lines) {
    if (!price) {
      // Try sold-specific patterns first
      for (const pattern of soldPricePatterns) {
        const soldMatch = pattern.exec(line);
        if (soldMatch) {
          const val = Number(soldMatch[1].replace(/,/g, ""));
          if (!Number.isNaN(val) && val > 10 && val < 50000) { // Filter obvious outliers
            price = val;
            currency = "USD";
            break;
          }
        }
      }
      
      // Fall back to general price pattern
      if (!price) {
        PRICE_RE.lastIndex = 0;
        const m = PRICE_RE.exec(line);
        if (m) {
          const val = Number(m[1].replace(/,/g, ""));
          // Filter outliers: reasonable range for comics ($10-$50k)
          if (!Number.isNaN(val) && val > 10 && val < 50000) {
            price = val;
            currency = USD_CURRENCY_HINT.test(line) ? "USD" : undefined;
          }
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
  site?: string;
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


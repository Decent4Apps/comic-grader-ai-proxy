// src/lib/firecrawl.ts
// Firecrawl v2 API - Using 'firecrawl' npm package v4.3.8
// Based on: https://docs.firecrawl.dev/introduction

import Firecrawl from 'firecrawl';

const API_KEY = process.env.FIRECRAWL_API_KEY || "";

// Initialize Firecrawl client (singleton for performance)
let firecrawlClient: Firecrawl | null = null;

function getFirecrawl() {
  if (!firecrawlClient && API_KEY) {
    firecrawlClient = new Firecrawl({ apiKey: API_KEY });
  }
  return firecrawlClient;
}

// --- Main Search with Scraping (v2 - ONE call gets everything!) ---

export async function searchWithScrape(query: string, limit: number = 6) {
  const client = getFirecrawl();
  if (!client) {
    throw new Error('Firecrawl API key not configured');
  }

  console.log('[Firecrawl v2] Searching with scraping:', { query, limit });

  try {
    // v2 API: search() with scrapeOptions returns URLs + markdown in ONE call!
    const result = await client.search(query, {
      limit,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
        excludeTags: ['nav', 'footer', 'header', 'ads'],
        waitFor: 3000,
      }
    });

    console.log('[Firecrawl v2] Response received:', {
      hasWeb: !!result.web,
      count: result.web?.length || 0
    });

    // v2 Response structure: { web: [...], news: [...], images: [...] }
    // Each web item has: { url, title, description, markdown }
    if (!result.web || result.web.length === 0) {
      console.warn('[Firecrawl v2] No web results returned');
      return [];
    }

    // Return results with markdown included
    const results = result.web.map((item: any) => {
      console.log('[Firecrawl v2] Item:', {
        url: item.url,
        title: item.title,
        hasMarkdown: !!item.markdown,
        markdownLength: item.markdown?.length || 0
      });

      return {
        url: item.url,
        title: item.title,
        description: item.description,
        markdown: item.markdown || ''
      };
    });

    console.log('[Firecrawl v2] Returning', results.length, 'results');
    return results;

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

// Price patterns - look for sold prices specifically
const SOLD_PRICE_PATTERNS = [
  /sold.*?\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  /price.*?\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:USD|sold|sale)/i,
];

const GRADE_RE = /\bCGC\s*([0-9]\.[0-9]|10(?:\.0)?)\b/i;
const DATE_RE = /\b(Sold|Ended|Completed|Date|On)\s*(on|:)?\s*([A-Za-z]{3,}\s*\d{1,2},?\s*\d{2,4}|\d{1,2}[\/\-][A-Za-z]{3}[\/\-]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;

export function parseSaleFromMarkdown(
  url: string,
  title: string | undefined,
  md: string
): ParsedSale {
  let price: number | undefined;
  let gradeDetected: string | undefined;
  let dateText: string | undefined;

  if (!md || md.length === 0) {
    console.log('[Parse] No markdown content for:', url);
    return { url, title, price: undefined, currency: 'USD' };
  }

  console.log('[Parse] Processing markdown length:', md.length);

  // Try sold-specific price patterns first
  for (const pattern of SOLD_PRICE_PATTERNS) {
    const match = pattern.exec(md);
    if (match) {
      const val = Number(match[1].replace(/,/g, ""));
      if (!Number.isNaN(val) && val > 10 && val < 50000) {
        price = val;
        console.log('[Parse] Found price:', price);
        break;
      }
    }
  }

  // Extract grade
  const gradeMatch = GRADE_RE.exec(md);
  if (gradeMatch) {
    gradeDetected = `CGC ${gradeMatch[1]}`;
  }

  // Extract date
  const dateMatch = DATE_RE.exec(md);
  if (dateMatch) {
    dateText = dateMatch[0];
  }

  console.log('[Parse] Extracted from', url, ':', { price, gradeDetected, dateText });

  return {
    url,
    title,
    price,
    currency: price ? 'USD' : undefined,
    gradeDetected,
    dateText
  };
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

  return {
    count: prices.length,
    avg: +(sum / sorted.length).toFixed(2),
    median: +median.toFixed(2),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    currency: "USD" as const,
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


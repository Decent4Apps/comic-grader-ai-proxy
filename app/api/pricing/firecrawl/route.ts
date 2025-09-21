import { withCORS } from "@/src/lib/cors";
import { db } from "@/src/db/client";
import { pricingCache } from "@/src/db/schema";
import { and, eq, gt } from "drizzle-orm";

export const runtime = "nodejs";

type QueryInput = {
  comicTitle: string;
  issueNumber?: string;
  publisher?: string;
  year?: string;
  gradeRange?: { min: number; max: number };
  max?: number;            // per-site limit (default 5)
  cacheTtlMinutes?: number; // default 240 (4h)
  bypassCache?: boolean;    // set true to force refresh
};

type Comp = {
  price: number;
  currency: "USD";
  title?: string;
  source: string;
  url: string;
  snippet?: string;
  date?: string;
};

type PricingPayload = {
  ok: true;
  query: Record<string, any>;
  stats: { count: number; averageUsd: number | null; medianUsd: number | null };
  comps: Comp[];
};

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search";

export const POST = withCORS(async (req) => {
  if (!process.env.FIRECRAWL_API_KEY) {
    return Response.json({ error: "FIRECRAWL_API_KEY missing" }, { status: 500 });
  }

  const body = (await req.json()) as QueryInput;
  const {
    comicTitle,
    issueNumber,
    publisher,
    year,
    gradeRange,
    max = 5,
    cacheTtlMinutes = 240,
    bypassCache = false,
  } = body;

  if (!comicTitle?.trim()) {
    return Response.json({ error: "comicTitle required" }, { status: 400 });
  }

  // ---------- Cache lookup ----------
  const key = makeCacheKey({ comicTitle, issueNumber, publisher, year, gradeRange });
  const now = new Date();
  const ttlMs = Math.max(1, cacheTtlMinutes) * 60 * 1000;

  if (!bypassCache) {
    const fresh = await db
      .select()
      .from(pricingCache)
      .where(and(eq(pricingCache.key, key), gt(pricingCache.expiresAt, now)));

    if (fresh.length) {
      return Response.json(fresh[0].payload as PricingPayload);
    }
  }

  // ---------- Build queries ----------
  const basePhrases = [
    `${comicTitle} ${issueNumber ? "#" + String(issueNumber).trim() : ""} sold price`,
    `${comicTitle} ${issueNumber ? "#" + String(issueNumber).trim() : ""} sale`,
  ]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const hints = [
    publisher && `publisher:${publisher}`,
    year && `year:${year}`,
    gradeRange && `grade ${gradeRange.min}-${gradeRange.max}`,
  ]
    .filter(Boolean)
    .join(" ");

  const sites = [
    "site:ebay.com",
    "site:heritageauctions.com",
    "site:mycomicshop.com",
    "site:gpanalysis.com",
    "site:gocollect.com",
    "site:shortboxed.com",
  ];

  const queries = sites.flatMap((site) =>
    basePhrases.map((q) => `${q} ${hints} ${site}`.replace(/\s+/g, " ").trim())
  );

  // ---------- Firecrawl fetch ----------
  const headers = {
    Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    "Content-Type": "application/json",
  };

  const priceRegex = /\$[\s]*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
  const dateRegex =
    /\b(20[0-9]{2}|19[0-9]{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+[0-9]{1,2},\s+(20[0-9]{2}|19[0-9]{2})/gi;

  const seen = new Set<string>();
  const comps: Comp[] = [];
  const MAX_TOTAL = Math.min(queries.length * Math.max(1, max), 60);

  for (const q of queries) {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: q,
        limit: Math.min(max, 5),
        sources: ["web"],
        scrapeOptions: {
          formats: ["markdown", "html"],
          onlyMainContent: true,
          location: { country: "US", languages: ["en-US"] },
          storeInCache: true,
          proxy: "auto",
        },
      }),
    }).catch(() => null);

    if (!res || !res.ok) continue;

    const data = (await res.json()) as any;
    const results: any[] = data?.data?.web ?? [];
    for (const r of results) {
      const url: string | undefined = r?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const domain = safeDomain(url);
      const text = [r.markdown, r.html, r.rawHtml, r.description, r.title]
        .filter(Boolean)
        .join("\n")
        .slice(0, 200_000);

      // Extract prices
      const prices: number[] = [];
      for (const match of text.matchAll(priceRegex)) {
        const raw = (match[1] || "").replace(/,/g, "");
        const val = parseFloat(raw);
        if (!Number.isNaN(val) && val > 0 && val < 100000) prices.push(val);
      }
      if (!prices.length) continue;

      // Prefer context that indicates actual sale
      const score = (v: number) => {
        const pattern = new RegExp(
          `(sold|hammer|final|winning bid|price)[^\\n]{0,60}\\$?${escapeForRegExp(
            v.toLocaleString("en-US")
          )}`,
          "i"
        );
        return pattern.test(text) ? 3 : 1;
      };

      const pick = prices
        .map((p) => ({ p, s: score(p) }))
        .sort((a, b) => b.s - a.s || b.p - a.p)[0].p;

      const dateMatch = text.match(dateRegex)?.[0];

      comps.push({
        price: pick,
        currency: "USD",
        title: r.title ?? undefined,
        source: domain,
        url,
        snippet: r.description ?? undefined,
        date: dateMatch ?? undefined,
      });

      if (comps.length >= MAX_TOTAL) break;
    }
    if (comps.length >= MAX_TOTAL) break;
  }

  const normalized = dedupeComps(comps);
  const prices = normalized.map((c) => c.price).sort((a, b) => a - b);
  const median =
    prices.length === 0
      ? null
      : prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  const avg =
    prices.length === 0
      ? null
      : Math.round(
          (prices.reduce((a, b) => a + b, 0) / prices.length) * 100
        ) / 100;

  const payload: PricingPayload = {
    ok: true,
    query: { comicTitle, issueNumber, publisher, year, gradeRange },
    stats: { count: normalized.length, averageUsd: avg, medianUsd: median },
    comps: normalized.slice(0, 50),
  };

  // ---------- Write cache ----------
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insert(pricingCache)
    .values({ key, payload, expiresAt })
    .onConflictDoUpdate({
      target: pricingCache.key,
      set: { payload, expiresAt },
    });

  return Response.json(payload);
});

// utils
function makeCacheKey(parts: Record<string, any>) {
  const stable = JSON.stringify(parts, Object.keys(parts).sort());
  // lightweight hash
  let h = 0;
  for (let i = 0; i < stable.length; i++) {
    h = (h << 5) - h + stable.charCodeAt(i);
    h |= 0;
  }
  return `pricing:${Math.abs(h)}`;
}

function safeDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
function dedupeComps(cs: Comp[]) {
  const makeKey = (c: Comp) => `${c.source}|${Math.round(c.price)}|${c.url}`;
  const m = new Map<string, Comp>();
  for (const c of cs) if (!m.has(makeKey(c))) m.set(makeKey(c), c);
  return [...m.values()];
}
function escapeForRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

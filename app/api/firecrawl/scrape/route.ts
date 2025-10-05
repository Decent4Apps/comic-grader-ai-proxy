import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

type Doc = {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      issue,
      publisher,
      year,
      grade,
      soldOnly,
      maxResults,
      timeframe,
      firecrawlOptions
    } = body || {};

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Missing 'title'." },
        { status: 400 }
      );
    }

    // Build search query for eBay sold/completed
    const q: string[] = [`"${title}"`];
    if (issue) q.push(`#${issue}`, `issue ${issue}`);
    if (publisher) q.push(String(publisher));
    if (year) q.push(String(year));
    if (grade) q.push(String(grade));
    q.push("comic book");
    if (soldOnly) q.push("sold", "-lot", "-digital");

    const query = `site:ebay.com ${q.join(" ")} LH_Sold=1 LH_Complete=1`;

    // Google time filter code (TBS)
    const tbsMap: Record<string, string> = {
      week: "qdr:w",
      month: "qdr:m",
      quarter: "qdr:m3",
      year: "qdr:y"
    };
    const tbs = tbsMap[timeframe || "month"];

    // Firecrawl v2 search (IMPORTANT: query is arg #1, options are arg #2)
    const result = await firecrawl.search(query, {
      limit: typeof maxResults === "number" ? maxResults : 12,
      sources: ["web"],
      tbs,
      scrapeOptions: {
        // markdown gives us text to parse prices from
        formats: Array.isArray(firecrawlOptions?.formats) && firecrawlOptions.formats.length
          ? firecrawlOptions.formats
          : ["markdown"],
        onlyMainContent: firecrawlOptions?.onlyMainContent !== false,
        includeTags: firecrawlOptions?.includeTags,
        excludeTags: firecrawlOptions?.excludeTags,
        // wait a bit for dynamic sections
        waitFor: typeof firecrawlOptions?.waitFor === "number" ? firecrawlOptions.waitFor : 3000,
        blockAds: true,
        removeBase64Images: true,
        // leave network-related extras to defaults; search() already handles caching/maxAge typing
        proxy: "auto",
        skipTlsVerification: true,
        storeInCache: true
      }
    });

    // New SDK returns an array of docs
    const items: Doc[] = Array.isArray(result) ? (result as Doc[]) : [];

    // Extract simple $price from title/desc/markdown (keep as-is; refine later)
    const listings: Array<{
      title: string;
      price: number;
      url: string;
      condition: string;
      soldDate: string;
    }> = [];

    for (const item of items) {
      const content = `${item.title ?? ""} ${item.description ?? ""} ${item.markdown ?? ""}`;
      const m = content.match(/\$(\d{1,6}(?:\.\d{2})?)/);
      if (m) {
        listings.push({
          title: item.title ?? "Unknown",
          price: parseFloat(m[1]),
          url: item.url ?? "",
          condition: "Unknown",
          soldDate: new Date().toISOString()
        });
      }
    }

    return NextResponse.json({
      success: true,
      listings,
      count: listings.length,
      query
    });
  } catch (err: any) {
    console.error("[Pricing] /pricing/firecrawl error:", err);
    return NextResponse.json(
      { success: false, listings: [], error: err?.message ?? "Pricing failed" },
      { status: err?.status ?? 500 }
    );
  }
}

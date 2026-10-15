import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../../lib/paid-security.mjs";
import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";

export const runtime = "nodejs";

type Doc = {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
};

export async function POST(req: NextRequest) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  try {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Firecrawl is not configured" }, { status: 503 });
    const firecrawl = new Firecrawl({ apiKey });
    const body = await readPaidJson(req);
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

    // Google time filter (TBS)
    const tbsMap: Record<string, string> = {
      week: "qdr:w",
      month: "qdr:m",
      quarter: "qdr:m3",
      year: "qdr:y"
    };
    const tbs = tbsMap[timeframe || "month"];

    // Firecrawl v2 search — note: returns an ARRAY of documents
    const result = await firecrawl.search(query, {
      limit: Math.min(25, Math.max(1, Number(maxResults) || 12)),
      sources: ["web"],
      tbs,
      scrapeOptions: {
        formats:
          Array.isArray(firecrawlOptions?.formats) && firecrawlOptions.formats.length
            ? firecrawlOptions.formats
            : ["markdown"],
        onlyMainContent: firecrawlOptions?.onlyMainContent !== false,
        includeTags: firecrawlOptions?.includeTags,
        excludeTags: firecrawlOptions?.excludeTags,
        waitFor:
          typeof firecrawlOptions?.waitFor === "number" ? firecrawlOptions.waitFor : 3000,
        blockAds: true,
        removeBase64Images: true,
        proxy: "auto",
        skipTlsVerification: true,
        storeInCache: true
      }
    });

    // New SDK shape: result is Doc[]
    const items: Doc[] = Array.isArray(result) ? (result as Doc[]) : [];

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

import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "firecrawl-sdk";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

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
      firecrawlOptions,
    } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Missing 'title'." },
        { status: 400 }
      );
    }

    // Build search query optimized for sold listings
    const q = [`"${title}"`];
    if (issue) q.push(`#${issue}`, `issue ${issue}`);
    if (publisher) q.push(publisher);
    if (year) q.push(String(year));
    if (grade) q.push(String(grade));
    q.push("comic book");
    if (soldOnly) q.push("sold", "-lot", "-digital");

    // eBay sold/completed semantics in query text
    const query = `site:ebay.com ${q.join(" ")} LH_Sold=1 LH_Complete=1`;

    // Google time-bounded search parameter
    const tbsMap: Record<string, string> = {
      week: "qdr:w",
      month: "qdr:m",
      quarter: "qdr:m3",
      year: "qdr:y",
    };
    const tbs = tbsMap[timeframe || "month"];

    const result = await firecrawl.search({
      query,
      limit: maxResults ?? 12,
      sources: ["web"],
      tbs,
      scrapeOptions: {
        formats: firecrawlOptions?.formats ?? ["markdown"],
        onlyMainContent: firecrawlOptions?.onlyMainContent !== false,
        includeTags: firecrawlOptions?.includeTags,
        excludeTags: firecrawlOptions?.excludeTags,
        maxAge: firecrawlOptions?.maxAge ?? 172800000,
        waitFor: firecrawlOptions?.waitFor ?? 3000,
        blockAds: true,
        removeBase64Images: true,
        proxy: "auto",
        skipTlsVerification: true,
        storeInCache: true,
      },
    });

    // Naive price extraction (you can improve later)
    const listings: Array<{
      title: string;
      price: number;
      url: string;
      condition: string;
      soldDate: string;
    }> = [];

    const items = result?.data?.web ?? [];
    for (const item of items) {
      const content = `${item.title ?? ""} ${item.description ?? ""} ${item.markdown ?? ""}`;
      const priceMatch = content.match(/\$(\d{1,6}(?:\.\d{2})?)/);
      if (priceMatch) {
        listings.push({
          title: item.title ?? "Unknown",
          price: parseFloat(priceMatch[1]),
          url: item.url ?? "",
          condition: "Unknown",
          soldDate: new Date().toISOString(), // You can parse sold date from content later
        });
      }
    }

    return NextResponse.json({
      success: true,
      listings,
      count: listings.length,
      query,
    });
  } catch (err: any) {
    console.error("[Pricing] /pricing/firecrawl error:", err);
    return NextResponse.json(
      { success: false, listings: [], error: err?.message ?? "Pricing failed" },
      { status: err?.status ?? 500 }
    );
  }
}

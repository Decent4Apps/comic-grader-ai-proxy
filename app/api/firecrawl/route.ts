import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      query,
      limit,
      sources,
      tbs,
      scrapeOptions,
      timeout,
      ignoreInvalidURLs
    } = body || {};

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { success: false, error: "Body must include a string 'query'." },
        { status: 400 }
      );
    }

    // IMPORTANT: pass query as first arg, options as second
    const result = await firecrawl.search(query, {
      limit: typeof limit === "number" ? limit : 5,
      sources: Array.isArray(sources) && sources.length ? sources : ["web"],
      tbs, // e.g. "qdr:m" for past month
      timeout: typeof timeout === "number" ? timeout : 60000,
      ignoreInvalidURLs: ignoreInvalidURLs !== false,
      scrapeOptions: scrapeOptions
        ? {
            formats:
              Array.isArray(scrapeOptions.formats) && scrapeOptions.formats.length
                ? scrapeOptions.formats
                : ["markdown"],
            onlyMainContent: scrapeOptions.onlyMainContent !== false,
            includeTags: scrapeOptions.includeTags,
            excludeTags: scrapeOptions.excludeTags,
            maxAge:
              typeof scrapeOptions.maxAge === "number" ? scrapeOptions.maxAge : 172800000,
            waitFor:
              typeof scrapeOptions.waitFor === "number" ? scrapeOptions.waitFor : 0,
            skipTlsVerification: scrapeOptions.skipTlsVerification !== false,
            blockAds: scrapeOptions.blockAds !== false,
            removeBase64Images: scrapeOptions.removeBase64Images !== false,
            proxy: scrapeOptions.proxy ?? "auto",
            storeInCache: scrapeOptions.storeInCache !== false
          }
        : undefined
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Firecrawl] /api/firecrawl error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Firecrawl request failed" },
      { status: err?.status ?? 500 }
    );
  }
}

export async function GET() {
  // Simple health check
  return NextResponse.json({
    status: "ok",
    sdk: "@mendable/firecrawl-js",
    ts: new Date().toISOString()
  });
}

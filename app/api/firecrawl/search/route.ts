import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const {
      query,
      limit,
      sources,
      tbs,
      scrapeOptions,
      timeout,
      ignoreInvalidURLs,
    } = await req.json();

    const result = await firecrawl.search({
      query,
      limit: limit ?? 5,
      sources: sources ?? ["web"],
      tbs,
      timeout: timeout ?? 60000,
      ignoreInvalidURLs: ignoreInvalidURLs !== false,
      scrapeOptions: scrapeOptions
        ? {
            formats: scrapeOptions.formats ?? ["markdown"],
            onlyMainContent: scrapeOptions.onlyMainContent !== false,
            includeTags: scrapeOptions.includeTags,
            excludeTags: scrapeOptions.excludeTags,
            maxAge: scrapeOptions.maxAge ?? 172800000,
            waitFor: scrapeOptions.waitFor ?? 0,
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
    console.error("[Firecrawl] /search error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Search failed" },
      { status: err?.status ?? 500 }
    );
  }
}

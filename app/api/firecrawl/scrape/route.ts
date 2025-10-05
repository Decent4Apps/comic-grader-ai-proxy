import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "firecrawl-sdk";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { url, scrapeOptions } = await req.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Body must include { url }" },
        { status: 400 }
      );
    }

    const result = await firecrawl.scrapeUrl(url, {
      formats: scrapeOptions?.formats ?? ["markdown"],
      onlyMainContent: scrapeOptions?.onlyMainContent !== false,
      includeTags: scrapeOptions?.includeTags,
      excludeTags: scrapeOptions?.excludeTags,
      maxAge: scrapeOptions?.maxAge ?? 172800000,
      waitFor: scrapeOptions?.waitFor ?? 0,
      skipTlsVerification: scrapeOptions?.skipTlsVerification !== false,
      blockAds: scrapeOptions?.blockAds !== false,
      removeBase64Images: scrapeOptions?.removeBase64Images !== false,
      proxy: scrapeOptions?.proxy ?? "auto",
      storeInCache: scrapeOptions?.storeInCache !== false
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Firecrawl] /scrape error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Scrape failed" },
      { status: err?.status ?? 500 }
    );
  }
}

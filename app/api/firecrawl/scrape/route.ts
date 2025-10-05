import { NextRequest, NextResponse } from "next/server";
import Firecrawl from "@mendable/firecrawl-js";

export const runtime = "nodejs";

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { url, scrapeOptions } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { success: false, error: "Body must include a string { url }" },
        { status: 400 }
      );
    }

    const result = await firecrawl.scrapeUrl(url, {
      formats:
        Array.isArray(scrapeOptions?.formats) && scrapeOptions?.formats.length
          ? scrapeOptions?.formats
          : ["markdown"],
      onlyMainContent: scrapeOptions?.onlyMainContent !== false,
      includeTags: scrapeOptions?.includeTags,
      excludeTags: scrapeOptions?.excludeTags,
      maxAge:
        typeof scrapeOptions?.maxAge === "number" ? scrapeOptions?.maxAge : 172800000,
      waitFor:
        typeof scrapeOptions?.waitFor === "number" ? scrapeOptions?.waitFor : 0,
      skipTlsVerification: scrapeOptions?.skipTlsVerification !== false,
      blockAds: scrapeOptions?.blockAds !== false,
      removeBase64Images: scrapeOptions?.removeBase64Images !== false,
      proxy: scrapeOptions?.proxy ?? "auto",
      storeInCache: scrapeOptions?.storeInCache !== false
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Firecrawl] /firecrawl/scrape error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Scrape failed" },
      { status: err?.status ?? 500 }
    );
  }
}

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

    /**
     * NOTE: For @mendable/firecrawl-js `scrapeUrl(url, options)` the SDK typing
     * does NOT include some fields (e.g., maxAge, storeInCache). Passing them
     * causes TS errors. We only pass commonly-typed safe fields below.
     *
     * If you need cache control, use the `search(query, { scrapeOptions: { maxAge } })`
     * path instead; `maxAge` is typed on that code path in the SDK.
     */
    const result = await firecrawl.scrapeUrl(url, {
      // Output formats: "markdown", "html", "links", "screenshot", "summary", "json"
      formats:
        Array.isArray(scrapeOptions?.formats) && scrapeOptions.formats.length
          ? scrapeOptions.formats
          : ["markdown"],

      // Keep to safe, typed fields
      onlyMainContent: scrapeOptions?.onlyMainContent !== false,
      includeTags: scrapeOptions?.includeTags,
      excludeTags: scrapeOptions?.excludeTags,

      // Wait for async content (ms)
      waitFor:
        typeof scrapeOptions?.waitFor === "number" ? scrapeOptions.waitFor : 0,

      // Booleans that are typed in the SDK
      blockAds: scrapeOptions?.blockAds !== false,
      removeBase64Images: scrapeOptions?.removeBase64Images !== false
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

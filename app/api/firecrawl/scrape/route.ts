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

    // NOTE:
    // @mendable/firecrawl-js `scrapeUrl(url, options)` does NOT type `maxAge`.
    // Caching still works with SDK defaults. Remove maxAge to satisfy TS.
    const result = await firecrawl.scrapeUrl(url, {
      // output formats: "markdown", "html", "links", "screenshot", "summary", "json"
      formats:
        Array.isArray(scrapeOptions?.formats) && scrapeOptions.formats.length
          ? scrapeOptions.formats
          : ["markdown"],

      // Preserve the other commonly-used, typed options
      onlyMainContent: scrapeOptions?.onlyMainContent !== false,
      includeTags: scrapeOptions?.includeTags,
      excludeTags: scrapeOptions?.excludeTags,

      // Wait for async content (ms). If not provided, default 0.
      waitFor:
        typeof scrapeOptions?.waitFor === "number" ? scrapeOptions.waitFor : 0,

      // These are booleans that are typed in the SDK options
      skipTlsVerification: scrapeOptions?.skipTlsVerification !== false,
      blockAds: scrapeOptions?.blockAds !== false,
      removeBase64Images: scrapeOptions?.removeBase64Images !== false,

      // Networking / infra
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

// app/api/pricing/firecrawl/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Firecrawl from 'firecrawl-sdk';

// Enable 60s timeout and Node.js runtime
export const maxDuration = 60;
export const runtime = 'nodejs';

// Reuse Firecrawl instance
let firecrawlInstance: Firecrawl | null = null;

function getFirecrawl() {
  if (!firecrawlInstance && process.env.FIRECRAWL_API_KEY) {
    firecrawlInstance = new Firecrawl({ 
      apiKey: process.env.FIRECRAWL_API_KEY 
    });
  }
  return firecrawlInstance;
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  
  try {
    const body = await request.json();
    const { title, issue, publisher, year, grade, soldOnly, maxResults, timeframe, firecrawlOptions } = body;

    const firecrawl = getFirecrawl();
    if (!firecrawl) {
      return NextResponse.json(
        { success: false, listings: [], error: 'Firecrawl API key not configured' },
        { status: 503 }
      );
    }

    // Build eBay search query
    const queryParts = [`"${title}"`];
    if (issue) queryParts.push(`#${issue}`, `issue ${issue}`);
    if (publisher) queryParts.push(publisher);
    if (year) queryParts.push(year);
    if (grade) queryParts.push(grade);
    queryParts.push('comic book');
    if (soldOnly) {
      queryParts.push('sold', '-lot', '-digital');
    }
    const query = `site:ebay.com ${queryParts.join(' ')} LH_Sold=1 LH_Complete=1`;

    // Get timeframe filter
    const tbsMap: Record<string, string> = {
      'week': 'qdr:w',
      'month': 'qdr:m',
      'quarter': 'qdr:m3',
      'year': 'qdr:y'
    };
    const tbs = tbsMap[timeframe || 'month'] || 'qdr:m';

    // FIXED: Increased timeout from 8000ms to 55000ms for Vercel Pro
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    try {
      // Call Firecrawl v2
      const result = await firecrawl.search({
        query,
        limit: maxResults || 12,
        sources: ['web'],
        tbs,
        scrapeOptions: {
          formats: firecrawlOptions?.formats || ['markdown'],
          onlyMainContent: firecrawlOptions?.onlyMainContent !== false,
          includeTags: firecrawlOptions?.includeTags,
          excludeTags: firecrawlOptions?.excludeTags,
          maxAge: firecrawlOptions?.maxAge || 172800000,
          waitFor: firecrawlOptions?.waitFor || 3000,
          blockAds: true,
          removeBase64Images: true,
          proxy: 'auto',
          skipTlsVerification: true,
          storeInCache: true,
        }
      });

      clearTimeout(timeout);

      console.log('[Pricing] Firecrawl search completed:', {
        query,
        results: result.data?.web?.length || 0,
        took_ms: Date.now() - started
      });

      // Parse listings from results
      const listings: any[] = [];
      if (result.data?.web) {
        for (const item of result.data.web) {
          // Extract pricing data from markdown/title/description
          const content = `${item.title} ${item.description} ${item.markdown || ''}`;
          const priceMatch = content.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
          
          if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            listings.push({
              title: item.title,
              price: price,
              url: item.url,
              condition: 'Unknown',
              soldDate: new Date().toISOString(),
            });
          }
        }
      }

      console.log('[Pricing] Found listings:', listings.length);

      return NextResponse.json({
        success: true,
        listings,
        count: listings.length,
        query,
        took_ms: Date.now() - started
      });

    } catch (searchError: any) {
      clearTimeout(timeout);
      
      if (searchError.name === 'AbortError') {
        console.error('[Pricing] Search timeout after 55s');
        return NextResponse.json(
          { 
            success: false, 
            listings: [], 
            error: 'Pricing search timeout',
            took_ms: Date.now() - started
          },
          { status: 504 }
        );
      }
      
      throw searchError;
    }

  } catch (error: any) {
    const msg = error?.message || String(error);
    const isAbort = /abort/i.test(msg) || /The operation was aborted/i.test(msg);
    
    console.error('[Pricing] Error:', msg);
    
    return NextResponse.json(
      { 
        success: false, 
        listings: [], 
        error: isAbort ? 'Pricing search timeout' : msg,
        took_ms: Date.now() - started
      },
      { status: isAbort ? 504 : 500 }
    );
  }
}

// Health check
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/pricing/firecrawl',
    configured: !!process.env.FIRECRAWL_API_KEY,
    maxDuration: 60,
    timestamp: new Date().toISOString()
  });
}

import { authorizePaidRequest, readPaidJson, boundAIInput } from "../../../lib/paid-security.mjs";
/**
 * Key Collector Comics API Route for Vercel
 * Deploy this to: app/api/key-collector/route.ts
 * 
 * Uses Firecrawl to scrape keycollectorcomics.com for key issue information
 * Returns data about first appearances, variants, and comic significance
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const denied = await authorizePaidRequest(req); if (denied) return denied;
  console.log('[Key Collector API] ========== ENTRY ==========');
  
  try {
    const body = await readPaidJson(req);
    const { title, issue, site } = body;

    console.log(`[Key Collector API] Request: ${title} #${issue} from ${site}`);

    if (!title || !issue) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Missing required fields: title and issue are required' 
        },
        { status: 400 }
      );
    }

    // Check if Firecrawl API key is configured
    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
    if (!firecrawlApiKey) {
      console.log('[Key Collector API] Firecrawl API key not configured');
      return NextResponse.json(
        { 
          success: false,
          error: 'Firecrawl service not configured' 
        },
        { status: 503 }
      );
    }

    // Build search URL for Key Collector Comics
    const searchQuery = `${title} ${issue}`.trim();
    const searchUrl = `https://www.keycollectorcomics.com/?s=${encodeURIComponent(searchQuery)}`;
    
    console.log(`[Key Collector API] Searching: ${searchUrl}`);

    // Call Firecrawl API to scrape the search results
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    const firecrawlData = await firecrawlResponse.json();

    if (!firecrawlResponse.ok) {
      console.error('[Key Collector API] Firecrawl error:', firecrawlData);
      return NextResponse.json(
        { 
          success: false,
          error: firecrawlData.error || 'Failed to scrape Key Collector Comics' 
        },
        { status: firecrawlResponse.status }
      );
    }

    console.log('[Key Collector API] Firecrawl success, parsing data...');

    // Extract key issue information from the scraped content
    const markdown = firecrawlData.data?.markdown || '';
    const html = firecrawlData.data?.html || '';
    const content = markdown + ' ' + html;

    // Parse the content to extract key issue data
    const keyIssues = parseKeyCollectorContent(content, issue);
    
    console.log(`[Key Collector API] Found ${keyIssues.length} key issues`);

    // Return in expected format
    return NextResponse.json({
      success: true,
      data: {
        web: [{
          markdown,
          description: extractFirstParagraph(markdown),
          url: searchUrl,
        }],
      },
    });

  } catch (error) {
    console.error('[Key Collector API] Error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

/**
 * Parse Key Collector content to extract key issue information
 */
function parseKeyCollectorContent(content: string, issueNumber: string): any[] {
  const issues: any[] = [];

  // Look for key issue indicators
  const keyIssuePatterns = [
    /first appearance/i,
    /1st appearance/i,
    /key issue/i,
    /variant cover/i,
    /limited edition/i,
    /exclusive/i,
  ];

  const hasKeyIndicators = keyIssuePatterns.some(pattern => pattern.test(content));

  if (hasKeyIndicators) {
    issues.push({
      issueNumber,
      description: extractDescription(content),
      significance: extractSignificance(content),
      characters: extractCharacters(content),
      tags: extractTags(content),
      firstAppearances: extractFirstAppearances(content),
      variants: extractVariants(content),
    });
  }

  return issues;
}

/**
 * Extract description from content
 */
function extractDescription(text: string): string {
  const descPatterns = [
    /description[:\s]+([^\n]{20,200})/i,
    /about this issue[:\s]+([^\n]{20,200})/i,
    /synopsis[:\s]+([^\n]{20,200})/i,
  ];

  for (const pattern of descPatterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }

  return extractFirstParagraph(text);
}

/**
 * Extract first meaningful paragraph
 */
function extractFirstParagraph(text: string): string {
  const paragraphs = text.split('\n').filter(p => p.trim().length > 20);
  return paragraphs[0]?.substring(0, 200) || 'No description available';
}

/**
 * Extract significance/importance
 */
function extractSignificance(text: string): string {
  if (/first appearance/i.test(text)) return 'First Appearance';
  if (/1st appearance/i.test(text)) return 'First Appearance';
  if (/key issue/i.test(text)) return 'Key Issue';
  if (/important/i.test(text)) return 'Important Issue';
  return 'Notable Issue';
}

/**
 * Extract character names
 */
function extractCharacters(text: string): string[] {
  const characters: string[] = [];
  
  // Common character name patterns
  const characterPatterns = [
    /featuring[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:appears|debuts|first)/gi,
  ];

  for (const pattern of characterPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const char = match[1]?.trim();
      if (char && !characters.includes(char)) {
        characters.push(char);
      }
    }
  }

  return characters.slice(0, 5); // Limit to 5 characters
}

/**
 * Extract tags/keywords
 */
function extractTags(text: string): string[] {
  const tags: string[] = [];
  
  if (/first appearance/i.test(text)) tags.push('First Appearance');
  if (/variant/i.test(text)) tags.push('Variant Cover');
  if (/key issue/i.test(text)) tags.push('Key Issue');
  if (/limited/i.test(text)) tags.push('Limited Edition');
  if (/exclusive/i.test(text)) tags.push('Exclusive');
  
  return tags;
}

/**
 * Extract first appearances mentioned
 */
function extractFirstAppearances(text: string): string[] {
  const appearances: string[] = [];
  
  const patterns = [
    /first appearance of ([^.,\n]+)/gi,
    /1st appearance of ([^.,\n]+)/gi,
    /debuts?[:\s]+([A-Z][^.,\n]+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const appearance = match[1]?.trim();
      if (appearance && !appearances.includes(appearance)) {
        appearances.push(appearance);
      }
    }
  }

  return appearances.slice(0, 5);
}

/**
 * Extract variant information
 */
function extractVariants(text: string): string[] {
  const variants: string[] = [];
  
  const variantPatterns = [
    /variant cover/i,
    /virgin variant/i,
    /retailer exclusive/i,
    /convention exclusive/i,
    /limited edition/i,
    /ratio variant/i,
  ];

  for (const pattern of variantPatterns) {
    if (pattern.test(text)) {
      const match = text.match(new RegExp(`(${pattern.source}[^.,\n]{0,30})`, 'i'));
      if (match) {
        variants.push(match[1].trim());
      }
    }
  }

  return variants.slice(0, 5);
}

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';


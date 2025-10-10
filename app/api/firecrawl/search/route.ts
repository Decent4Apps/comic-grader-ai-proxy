/**
 * Complete replacement for: app/api/firecrawl/search/route.ts
 * This file handles Firecrawl search requests with OpenAI integration
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    console.log('[Firecrawl Search] Received request:', body);

    // If this is an AI request, handle it
    if (body.model && body.messages) {
      return await handleAIRequest(body);
    }

    // Otherwise, handle as Firecrawl search
    return await handleFirecrawlSearch(body);

  } catch (error) {
    console.error('[Firecrawl Search] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleAIRequest(body: any) {
  const { model, messages, temperature, max_tokens } = body;

  try {
    console.log(`[Firecrawl Search - AI] Calling OpenAI with ${model}...`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: temperature,
      max_tokens: max_tokens,
      stream: false, // IMPORTANT: Must be false for proper typing
    });

    // Return OpenAI-compatible response
    return NextResponse.json({
      id: completion.id,
      object: 'chat.completion',
      created: completion.created,
      model: completion.model,
      choices: completion.choices,
      usage: completion.usage,
    });
  } catch (error) {
    console.error('[Firecrawl Search - AI] Error:', error);
    throw error;
  }
}

async function handleFirecrawlSearch(body: any) {
  // Your existing Firecrawl search logic here
  // This is a placeholder - keep your existing implementation
  
  console.log('[Firecrawl Search] Processing Firecrawl request...');
  
  // Return your existing Firecrawl response format
  return NextResponse.json({
    success: true,
    message: 'Firecrawl search endpoint',
  });
}

// Required exports for Next.js API routes
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


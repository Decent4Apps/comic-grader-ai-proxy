/**
 * Fix for app/api/firecrawl/search/route.ts
 * 
 * Replace the handleOpenAI function around line 75-95 with this:
 */

async function handleOpenAI(
  model: string,
  messages: any[],
  options: { temperature?: number; max_tokens?: number }
) {
  try {
    console.log(`[OpenAI] Calling ${model}...`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      stream: false, // IMPORTANT: Explicitly set to false to get proper typing
    });

    // TypeScript now knows this is ChatCompletion, not a Stream
    return NextResponse.json({
      id: completion.id,
      object: 'chat.completion',
      created: completion.created,
      model: completion.model,
      choices: completion.choices,
      usage: completion.usage,
    });
  } catch (error) {
    console.error('[OpenAI] Error:', error);
    throw error;
  }
}

/**
 * ALTERNATIVE FIX: If the above doesn't work, you can type cast:
 */

async function handleOpenAIAlternative(
  model: string,
  messages: any[],
  options: { temperature?: number; max_tokens?: number }
) {
  try {
    console.log(`[OpenAI] Calling ${model}...`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    }) as any; // Type cast as fallback

    return NextResponse.json({
      id: completion.id,
      object: 'chat.completion',
      created: completion.created,
      model: completion.model,
      choices: completion.choices,
      usage: completion.usage,
    });
  } catch (error) {
    console.error('[OpenAI] Error:', error);
    throw error;
  }
}


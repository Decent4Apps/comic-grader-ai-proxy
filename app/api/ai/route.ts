/**
 * Multi-Provider AI API Route for Vercel
 * Deploy this to your Vercel backend at: app/api/ai/route.ts
 * 
 * Supports: OpenAI, Anthropic, Google Gemini, X.AI Grok
 * Routes based on model name in the request
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
// import { GoogleGenerativeAI } from '@google/generative-ai'; // DISABLED: No vision support

// Initialize clients with validation
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  // Use default baseURL (proxy configured via environment)
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Gemini and Grok disabled - they don't properly support vision
// const gemini = new GoogleGenerativeAI(
//   process.env.GOOGLE_GEMINI_API_KEY || 
//   process.env.GEMINI_API_KEY || 
//   process.env.GOOGLE_AI_API_KEY || 
//   ''
// );

// const grok = new OpenAI({
//   apiKey: process.env.XAI_API_KEY,
//   baseURL: 'https://api.x.ai/v1',
// });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model, messages, temperature, max_tokens, stream = false } = body;

    console.log(`[AI API] Received request for model: ${model}`);

    // Route to appropriate provider based on model name
    // Only OpenAI and Anthropic are supported (vision-capable models)
    if (model.startsWith('gpt-') || model.startsWith('o1-') || model.includes('gpt')) {
      return await handleOpenAI(model, messages, { temperature, max_tokens, stream });
    }
    else if (model.startsWith('claude-') || model.includes('claude')) {
      return await handleAnthropic(model, messages, { temperature, max_tokens });
    }
    else if (model.startsWith('gemini-') || model.includes('gemini')) {
      console.log(`[AI API] Gemini disabled - no vision support`);
      return NextResponse.json(
        { error: `Gemini not supported - use GPT-4 or Claude instead` },
        { status: 400 }
      );
    }
    else if (model.startsWith('grok-') || model.includes('grok')) {
      console.log(`[AI API] Grok disabled - no vision support`);
      return NextResponse.json(
        { error: `Grok not supported - use GPT-4 or Claude instead` },
        { status: 400 }
      );
    }
    else {
      console.error(`[AI API] Unknown model: ${model}`);
      return NextResponse.json(
        { error: `Unknown model: ${model}. Supported: gpt-*, claude-*` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[AI API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle OpenAI requests
 */
async function handleOpenAI(
  model: string,
  messages: any[],
  options: { temperature?: number; max_tokens?: number; stream?: boolean }
) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }
    console.log(`[OpenAI] Calling ${model}...`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      stream: false, // Must be explicitly false for TypeScript
    });

    // Return in OpenAI-compatible format
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
 * Handle Anthropic Claude requests
 */
async function handleAnthropic(
  model: string,
  messages: any[],
  options: { temperature?: number; max_tokens?: number }
) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }
    console.log(`[Anthropic] Calling ${model}...`);

    // Convert OpenAI format to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    // Handle vision messages (images)
    const anthropicMessages = userMessages.map(msg => {
      if (Array.isArray(msg.content)) {
        // Convert OpenAI image format to Anthropic format
        const content = msg.content.map((item: any) => {
          if (item.type === 'image_url') {
            // Extract base64 data
            const base64Data = item.image_url.url.replace(/^data:image\/\w+;base64,/, '');
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Data,
              },
            };
          } else if (item.type === 'text') {
            return {
              type: 'text',
              text: item.text,
            };
          }
          return item;
        });
        return { role: msg.role, content };
      }
      return { role: msg.role, content: msg.content };
    });

    const response = await anthropic.messages.create({
      model,
      max_tokens: options.max_tokens || 4096,
      temperature: options.temperature,
      system: systemMessage?.content,
      messages: anthropicMessages,
    });

    // Convert Anthropic response to OpenAI format
    return NextResponse.json({
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content[0].type === 'text' ? response.content[0].text : '',
          },
          finish_reason: response.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error('[Anthropic] Error:', error);
    throw error;
  }
}

/**
 * DISABLED: Gemini doesn't properly support vision
 */
// async function handleGemini(
//   model: string,
//   messages: any[],
//   options: { temperature?: number; max_tokens?: number }
// ) {
//   try {
//     console.log(`[Gemini] Calling ${model}...`);

//     const geminiModel = gemini.getGenerativeModel({ model });

//     // Convert messages to Gemini format
//     const contents = messages.map(msg => {
//       if (Array.isArray(msg.content)) {
//         // Handle vision messages
//         const parts = msg.content.map((item: any) => {
//           if (item.type === 'image_url') {
//             const base64Data = item.image_url.url.replace(/^data:image\/\w+;base64,/, '');
//             return {
//               inlineData: {
//                 mimeType: 'image/jpeg',
//                 data: base64Data,
//               },
//             };
//           } else if (item.type === 'text') {
//             return { text: item.text };
//           }
//           return item;
//         });
//         return { role: msg.role === 'assistant' ? 'model' : 'user', parts };
//       }
//       return {
//         role: msg.role === 'assistant' ? 'model' : 'user',
//         parts: [{ text: msg.content }],
//       };
//     });

//     const result = await geminiModel.generateContent({
//       contents,
//       generationConfig: {
//         temperature: options.temperature,
//         maxOutputTokens: options.max_tokens,
//       },
//     });

//     const response = result.response;
//     const text = response.text();

//     // Convert to OpenAI format
//     return NextResponse.json({
//       id: `gemini-${Date.now()}`,
//       object: 'chat.completion',
//       created: Math.floor(Date.now() / 1000),
//       model,
//       choices: [
//         {
//           index: 0,
//           message: {
//             role: 'assistant',
//             content: text,
//           },
//           finish_reason: 'stop',
//         },
//       ],
//       usage: {
//         prompt_tokens: 0, // Gemini doesn't provide token counts easily
//         completion_tokens: 0,
//         total_tokens: 0,
//       },
//     });
//   } catch (error) {
//     console.error('[Gemini] Error:', error);
//     throw error;
//   }
// }

/**
 * DISABLED: Grok doesn't support image inputs
 */
// async function handleGrok(
//   model: string,
//   messages: any[],
//   options: { temperature?: number; max_tokens?: number; stream?: boolean }
// ) {
//   try {
//     console.log(`[Grok] Calling ${model}...`);

//     // Grok uses OpenAI-compatible API
//     const completion = await grok.chat.completions.create({
//       model,
//       messages,
//       temperature: options.temperature,
//       max_tokens: options.max_tokens,
//       stream: false, // Must be explicitly false for TypeScript
//     });

//     return NextResponse.json({
//       id: completion.id,
//       object: 'chat.completion',
//       created: completion.created,
//       model: completion.model,
//       choices: completion.choices,
//       usage: completion.usage,
//     });
//   } catch (error) {
//     console.error('[Grok] Error:', error);
//     throw error;
//   }
// }

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds for Vercel Pro


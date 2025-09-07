export const runtime = 'edge';

import OpenAI from 'openai';
import { z } from 'zod';
import { corsHeaders, okJSON } from '../_cors';

// Zod schema for validating GPT output
const IdentitySchema = z.object({
  year: z.number().int().min(1800).max(2030).nullable().optional(),
  player: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  card_number: z.string().nullable().optional(),
  set: z.string().nullable().optional(),
  subset: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  is_rookie: z.boolean().nullable().optional(),
  parallel: z.string().nullable().optional(),
  card_type: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  canonical_name: z.string().nullable().optional(),
  alt_queries: z.array(z.string()).default([])
});

type Identity = z.infer<typeof IdentitySchema>;

type RequestBody = {
  imageDataUrl?: string;
  imageUrl?: string;
};

// CORS preflight handler
export async function OPTIONS() {
  return new Response(null, { 
    status: 204, 
    headers: corsHeaders() 
  });
}

// Helper to convert data URL to base64
function dataUrlToBase64(dataUrl: string): string {
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl)) {
    throw new Error('imageDataUrl must be a valid base64 data URL');
  }
  return dataUrl.split(',')[1];
}

// Helper to validate and coerce GPT response
function validateAndCoerceIdentity(rawResponse: any): Identity {
  try {
    // Try to parse as JSON if it's a string
    let parsed = rawResponse;
    if (typeof rawResponse === 'string') {
      parsed = JSON.parse(rawResponse);
    }

    // Validate with Zod schema
    const validated = IdentitySchema.parse(parsed);
    
    // Set default grade to "Raw" if not specified
    if (!validated.grade) {
      validated.grade = "Raw";
    }

    return validated;
  } catch (error) {
    console.warn('Failed to validate GPT response, using fallback:', error);
    
    // Return a safe fallback
    return {
      year: null,
      player: null,
      team: null,
      card_number: null,
      set: null,
      subset: null,
      company: null,
      is_rookie: null,
      parallel: null,
      card_type: null,
      grade: "Raw",
      canonical_name: null,
      alt_queries: []
    };
  }
}

// Main analyze endpoint
export async function POST(req: Request) {
  try {
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders() 
          } 
        }
      );
    }

    const body: RequestBody = await req.json();
    const { imageDataUrl, imageUrl } = body;

    if (!imageDataUrl && !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageDataUrl or imageUrl required' }),
        { 
          status: 422, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders() 
          } 
        }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Prepare image for OpenAI Vision
    let imageContent: string;
    if (imageDataUrl) {
      imageContent = dataUrlToBase64(imageDataUrl);
    } else if (imageUrl) {
      // For imageUrl, we'll pass it directly to OpenAI
      imageContent = imageUrl;
    } else {
      throw new Error('No valid image provided');
    }

    // Create the vision prompt
    const prompt = `Analyze this trading card image and extract the following information in JSON format. Be precise and only include information you can clearly see. If uncertain about any field, use null.

Required JSON structure:
{
  "year": number or null (e.g., 2023, 2024),
  "player": string or null (player name),
  "team": string or null (team name),
  "card_number": string or null (card number like "22", "BDC-121", "SS-38"),
  "set": string or null (set name like "Topps Chrome", "Bowman Draft", "Prizm"),
  "subset": string or null (subset if applicable),
  "company": string or null (producing company like "Topps", "Panini", "Bowman"),
  "is_rookie": boolean or null (true if this is a rookie card),
  "parallel": string or null (parallel/variant like "Green Prizm", "Silver", "Holo", "Refractor"),
  "card_type": string or null (type like "Base", "Auto", "Refractor", "Holo"),
  "grade": string or null (grade like "Raw", "PSA 5", "PSA 10", "BGS 9.5"),
  "canonical_name": string or null (full card name like "2024 Panini Prizm Caitlin Clark Green #22"),
  "alt_queries": array of strings (helpful search variations)
}

Important:
- If you see a graded card (PSA, BGS, etc.), set the grade field accordingly
- If it's a raw card, set grade to "Raw"
- For alt_queries, provide 2-3 search variations (shorter versions, different word orders)
- Be conservative - prefer null over guessing
- Return ONLY the JSON, no other text`;

    // Make the OpenAI Vision API call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl ? `data:image/jpeg;base64,${imageContent}` : imageContent
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    });

    const gptResponse = response.choices[0]?.message?.content;
    if (!gptResponse) {
      throw new Error('No response from OpenAI');
    }

    // Parse and validate the response
    const identity = validateAndCoerceIdentity(gptResponse);

    // Return the response in the expected format
    return okJSON({
      identity
    });

  } catch (error: any) {
    console.error('[analyze] error:', error?.message || error);
    
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Failed to analyze image' 
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders() 
        } 
      }
    );
  }
}
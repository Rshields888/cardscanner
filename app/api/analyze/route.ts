export const runtime = 'nodejs';

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
  color: z.string().nullable().optional(), // NEW: Color/variant color
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

// Helper to convert data URL to base64 (fallback)
function dataUrlToBase64(dataUrl: string): string {
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl)) {
    throw new Error('imageDataUrl must be a valid base64 data URL');
  }
  return dataUrl.split(',')[1];
}

// Helper to convert data URL to base64 and optimize image
async function optimizeImageForGPT(dataUrl: string): Promise<string> {
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl)) {
    throw new Error('imageDataUrl must be a valid base64 data URL');
  }

  try {
    // Import sharp for image optimization
    const sharp = (await import('sharp')).default;
    const base64Data = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Get image metadata to calculate crop area
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width;
    const originalHeight = metadata.height;

    if (!originalWidth || !originalHeight) {
      throw new Error('Could not get image dimensions for optimization');
    }

    // Calculate crop area with more space on top to avoid cutting off card details
    // Keep 50% width but 60% height to preserve top of card
    const cropWidth = Math.floor(originalWidth * 0.5);  // 50% width
    const cropHeight = Math.floor(originalHeight * 0.6); // 60% height (more generous on top)
    const left = Math.floor((originalWidth - cropWidth) / 2);
    const top = Math.floor((originalHeight - cropHeight) * 0.3); // Start higher up (30% from top instead of center)

    // Optimized image processing for 5s target with good quality
    const optimized = await sharp(buffer)
      .extract({ left, top, width: cropWidth, height: cropHeight }) // Apply center crop
      .resize(500, 500, {  // Balanced size for speed and quality
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 75, progressive: false, mozjpeg: true }) // Balanced quality
      .toBuffer();

    return optimized.toString('base64');
  } catch (error) {
    console.error('Error optimizing image for GPT:', error);
    // Fallback to original base64 if optimization fails
    return dataUrl.split(',')[1];
  }
}

// Helper to validate and coerce GPT response
function validateAndCoerceIdentity(rawResponse: any): Identity {
  try {
    let parsed = rawResponse;
    
    if (typeof rawResponse === 'string') {
      // Clean up the response string
      let cleanedResponse = rawResponse.trim();
      
      // Remove any markdown code blocks
      cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      
      // Try to extract JSON from the response if it contains extra text
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[0];
      }
      
      // Parse the cleaned JSON
      parsed = JSON.parse(cleanedResponse);
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
    console.warn('Raw response was:', rawResponse);
    
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
      color: null,
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

    // Prepare image for OpenAI Vision with timeout
    let imageContent: string;
    if (imageDataUrl) {
      try {
        // Optimize and crop the image for better GPT performance with timeout
        imageContent = await Promise.race([
          optimizeImageForGPT(imageDataUrl),
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('Image optimization timeout')), 5000)
          )
        ]);
      } catch (error) {
        console.warn('Image optimization failed, using original:', error);
        // Fallback to original image if optimization fails or times out
        imageContent = dataUrlToBase64(imageDataUrl);
      }
    } else if (imageUrl) {
      // For imageUrl, we'll pass it directly to OpenAI
      imageContent = imageUrl;
    } else {
      throw new Error('No valid image provided');
    }

    // Optimized prompt for 5s target with all required fields
    const prompt = `Extract trading card data as JSON. Focus on these key fields:
{
  "year": number or null,
  "player": string or null,
  "team": string or null,
  "card_number": string or null,
  "set": string or null,
  "company": string or null,
  "is_rookie": boolean or null,
  "parallel": string or null,
  "color": string or null,
  "card_type": string or null,
  "grade": string or null,
  "canonical_name": string or null,
  "alt_queries": []
}

CRITICAL: Check for rookie indicators (RC, Rookie, etc.). Identify parallel/variant (Prizm, Chrome, Refractor, etc.) AND their color (Green, Silver, Gold, etc.). 
Look for grading (PSA, BGS, SGC labels). Check for autographs (Auto, Signature, etc.) and patches (RPA, Patch, Jersey, etc.).
Set grade="Raw" if ungraded. Set card_type to "Auto" if autographed, "RPA" if patch card, "Base" if neither.
For color: Extract the specific color/variant color (e.g., "Green", "Silver", "Gold", "Blue", "Purple", "Red", "Orange", "Black", "White").
Return JSON only.`;

    // Make the OpenAI Vision API call with ultra-speed optimizations
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
      max_tokens: 350,        // Increased for thorough analysis
      temperature: 0,         // More deterministic, faster
      top_p: 0.1,            // More focused responses
      frequency_penalty: 0,   // No penalty for repetition
      presence_penalty: 0     // No penalty for new topics
    }, {
      timeout: 15000          // 15 second timeout for thorough analysis
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
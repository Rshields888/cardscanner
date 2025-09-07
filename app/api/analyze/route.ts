export const runtime = 'nodejs';

import vision from '@google-cloud/vision';
import sharp from 'sharp';

type AnalyzeReq = { imageDataUrl?: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function fixPk(pk?: string) {
  return (pk || '').replace(/\\r/g, '').replace(/\\n/g, '\n');
}

const client = new vision.ImageAnnotatorClient({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL || '',
    private_key: fixPk(process.env.GCP_PRIVATE_KEY),
  },
});

function bad(body: any, status = 400) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function maybeUpscale(base64: string): Promise<string> {
  try {
    const buf = Buffer.from(base64, 'base64');
    const meta = await sharp(buf).metadata();
    const h = meta.height ?? 0;
    if (h < 800) {
      const out = await sharp(buf)
        .resize({ height: 1200, withoutEnlargement: false })
        .jpeg({ quality: 92 })
        .toBuffer();
      return out.toString('base64');
    }
    return base64;
  } catch {
    return base64;
  }
}

const SETS = ['Topps','Bowman','Panini','Prizm','Chrome','Select','Mosaic','Optic','Donruss','Score','Leaf','Allen & Ginter','Heritage','Stadium Club','Finest'];

function parseIdentity(text: string, webTitles: string[], logos: string[]) {
  const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
  const cardNum = (text.match(/\b(?:No\.|No|#|№)\s*([A-Z0-9-]+)\b/i) || [])[1] || '';
  const variant = /\bRC\b/.test(text) ? 'RC' : '';
  const set = SETS.find(s => new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\]{{}}]/g,'\\$&')}\\b`, 'i').test(text))
              || logos[0] || '';

  // Pull candidate names like "First Last", prefer the longest
  const nameCandidates = (text.match(/\b[A-Z][a-z]+ [A-Z][a-z-']+\b/g) || [])
    .filter(n => !SETS.includes(n.split(' ')[0])); // crude filter
  const player = nameCandidates.sort((a,b) => b.length - a.length)[0]
                || (webTitles[0]?.split(/[-–|•]/)[0].trim() || '');

  const canonical = [player, set].filter(Boolean).join(' — ') || 'Unknown Card';
  const mainQuery = [year, set, player, cardNum, variant].filter(Boolean).join(' ');
  const alt1 = [set, player, cardNum, 'RC'].filter(Boolean).join(' ');
  const alt2 = [year, set, player].filter(Boolean).join(' ');

  return {
    canonical_name: canonical,
    player,
    set,
    year,
    card_number: cardNum,
    variant,
    grading: null,
    query: mainQuery || 'trading card',
    alt_queries: [alt1, alt2].filter(Boolean),
  };
}

export async function POST(req: Request) {
  try {
    const { imageDataUrl }: AnalyzeReq = await req.json();
    if (!imageDataUrl || !/^data:image\/(jpe?g|png);base64,/.test(imageDataUrl)) {
      return bad({ error: 'imageDataUrl (base64 data URL) required' }, 422);
    }

    let base64 = imageDataUrl.split(',')[1];
    base64 = await maybeUpscale(base64);

    const [annot] = await client.annotateImage({
      image: { content: Buffer.from(base64, 'base64') },
      features: [
        { type: 'DOCUMENT_TEXT_DETECTION' },
        { type: 'WEB_DETECTION' },
        { type: 'LOGO_DETECTION' },
      ],
      imageContext: { languageHints: ['en'] },
    });

    const ocrText = annot.fullTextAnnotation?.text || '';
    const web = annot.webDetection;
    const webTitles =
      (web?.pagesWithMatchingImages || [])
        .map(p => (p.pageTitle || '').trim())
        .filter(Boolean)
        .slice(0, 5);
    const logos = (annot.logoAnnotations || []).map(l => l.description).filter(Boolean);

    const identity = parseIdentity(ocrText, webTitles, logos);

    return new Response(JSON.stringify({
      identity: {
        ...identity,
        ocr_text_debug: ocrText.slice(0, 5000),   // keep for debugging in popup
        web_titles_debug: webTitles,
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
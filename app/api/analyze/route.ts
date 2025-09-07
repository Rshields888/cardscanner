export const runtime = 'nodejs';

import vision from '@google-cloud/vision';
import { fixPk, pickEnv, envDiag } from '@/lib/env';

// Optional: text-only fallback via OpenAI (do NOT send image)
let useLLM = !!process.env.USE_LLM_FALLBACK && !!process.env.OPENAI_API_KEY;
let OpenAIClient: any = null;
if (useLLM) { try { OpenAIClient = (await import('openai')).default; } catch { useLLM = false; } }

type Body = { imageDataUrl?: string };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

const SETS = [
  'Topps','Bowman','Panini','Prizm','Chrome','Optic','Donruss','Select','Mosaic','Score','Leaf',
  'Allen & Ginter','Heritage','Stadium Club','Finest','Spectra','Contenders','Absolute'
];

// ---------- helpers ----------
async function toBuffer(dataUrl: string): Promise<Buffer> {
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl)) throw new Error('imageDataUrl must be base64 data URL');
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function enhance(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  let s = sharp(buf);
  if ((meta.height ?? 0) < 900) s = s.resize({ height: 1300, withoutEnlargement: false });
  return await s.normalize().gamma(1.1).sharpen(0.8).jpeg({ quality: 94 }).toBuffer();
}

function newClient() {
  const diag = envDiag();
  if (!diag.ok) throw new Error('MISSING_ENV: ' + diag.missing.join(','));
  return new vision.ImageAnnotatorClient({
    projectId: pickEnv('GOOGLE_PROJECT_ID','GCP_PROJECT_ID'),
    credentials: {
      client_email: pickEnv('GOOGLE_CLIENT_EMAIL','GCP_CLIENT_EMAIL') || '',
      private_key: fixPk(pickEnv('GOOGLE_PRIVATE_KEY','GCP_PRIVATE_KEY')),
    },
  });
}

type Rect = { left:number; top:number; width:number; height:number };
function rectFromFrac(meta:{width?:number;height?:number}, f:{x:number;y:number;w:number;h:number}): Rect {
  const W = meta.width ?? 0, H = meta.height ?? 0;
  return { left: Math.round(W*f.x), top: Math.round(H*f.y), width: Math.round(W*f.w), height: Math.round(H*f.h) };
}

async function multiROIs(buf: Buffer) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  // Full, nameplate (bottom ~30%), logo-band (top ~20%)
  const full: Rect = { left:0, top:0, width: meta.width!, height: meta.height! };
  const name = rectFromFrac(meta, { x:0.06, y:0.68, w:0.88, h:0.30 });
  const logo = rectFromFrac(meta, { x:0.08, y:0.02, w:0.84, h:0.22 });
  async function cut(r: Rect) {
    return sharp(buf).extract(r).resize({ height: Math.min(1100, Math.max(720, r.height)) })
      .jpeg({ quality: 96 }).toBuffer();
  }
  return { full: await cut(full), name: await cut(name), logo: await cut(logo) };
}

async function annot(client: any, buf: Buffer) {
  const [a] = await client.annotateImage({
    image: { content: buf },
    features: [
      { type: 'DOCUMENT_TEXT_DETECTION' },
      { type: 'WEB_DETECTION' },
      { type: 'LOGO_DETECTION' },
    ],
    imageContext: { languageHints: ['en'] },
  });
  return a;
}

function looksLikeName(s: string) {
  return /^[A-Z][a-z]+(?:[-'\s][A-Z][a-z]+)+$/.test(s) && !SETS.includes(s.split(' ')[0]);
}

function parseIdentity(text: string, entities: {text:string,score:number}[], logos: string[], webTitles: string[]) {
  const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
  const card = (text.match(/\b(?:No\.|No|#|№)\s*([A-Z0-9-]+)\b/i) || [])[1] || '';
  const variant = /\bRC\b/.test(text) ? 'RC' : '';
  const set = SETS.find(s => new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\\]{}]/g,'\\$&')}\\b`, 'i').test(text))
           || logos[0] || '';

  const ocrNames = (text.match(/\b[A-Z][a-z]+ [A-Z][a-z-']+\b/g) || []).filter(n => !SETS.includes(n.split(' ')[0]));
  const entityNames = entities.filter(e => looksLikeName(e.text))
                              .sort((a,b) => (b.score - a.score) || (b.text.length - a.text.length))
                              .map(e => e.text);
  const titleName = (webTitles[0]?.split(/[-–|•]/)[0].trim() || '');
  const player = ocrNames[0] || entityNames[0] || titleName || '';

  const canonical = [player, set].filter(Boolean).join(' — ') || 'Unknown Card';
  const query = [year, set, player, card, variant].filter(Boolean).join(' ') || 'trading card';
  const alt1 = [set, player, card, 'RC'].filter(Boolean).join(' ');
  const alt2 = [year, set, player].filter(Boolean).join(' ');
  const confidence =
    (player ? 0.4 : 0) + (set ? 0.2 : 0) + (year ? 0.15 : 0) + (card ? 0.25 : 0);

  return {
    canonical_name: canonical, player, set, year,
    card_number: card, variant, grading: null,
    query, alt_queries: [alt1, alt2].filter(Boolean),
    confidence: Math.round(confidence * 100)
  };
}

async function llmNormalize(ocr: string, logos: string[], titles: string[]) {
  if (!useLLM || !ocr) return null;
  try {
    const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });
    const prompt = `
Extract JSON with keys: player, set, year, card_number, variant (RC if applicable).
Use only the OCR text and hints. If unknown, leave empty.

OCR:
${ocr}

Hints:
logos: ${logos.join(', ')}
titles: ${titles.join(' | ')}
Return ONLY JSON.`;
    const resp = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: prompt,
      temperature: 0,
    });
    const text = resp.output_text || '';
    const json = JSON.parse(text);
    return json;
  } catch { return null; }
}

// ---------- route ----------
export async function POST(req: Request) {
  try {
    const diag = envDiag();
    if (!diag.ok) return new Response(JSON.stringify({ error:'MISSING_ENV', detail: diag.missing }),
      { status: 500, headers: { ...cors, 'Content-Type':'application/json' }});

    const { imageDataUrl }: Body = await req.json();
    if (!imageDataUrl) return new Response(JSON.stringify({ error:'imageDataUrl required' }),
      { status: 422, headers: { ...cors, 'Content-Type':'application/json' }});

    let buf = await toBuffer(imageDataUrl);
    buf = await enhance(buf);
    const rois = await multiROIs(buf);

    const client = newClient();
    const [aFull, aName, aLogo] = await Promise.all([
      annot(client, rois.full), annot(client, rois.name), annot(client, rois.logo)
    ]);

    const ocrText = [
      aFull.fullTextAnnotation?.text || '',
      aName.fullTextAnnotation?.text || '',
      aLogo.fullTextAnnotation?.text || '',
    ].join('\n');

    const webTitles = [
      ...(aFull.webDetection?.pagesWithMatchingImages || []),
      ...(aName.webDetection?.pagesWithMatchingImages || []),
      ...(aLogo.webDetection?.pagesWithMatchingImages || []),
    ].map(p => (p.pageTitle || '').trim()).filter(Boolean).slice(0,5);

    const logos = [
      ...(aFull.logoAnnotations || []),
      ...(aName.logoAnnotations || []),
      ...(aLogo.logoAnnotations || []),
    ].map(l => l.description).filter(Boolean);

    const entities = [
      ...(aFull.webDetection?.webEntities || []),
      ...(aName.webDetection?.webEntities || []),
      ...(aLogo.webDetection?.webEntities || []),
    ].map(e => ({ text: (e.description || '').trim(), score: e.score || 0 }))
     .filter(e => e.text);

    let identity = parseIdentity(ocrText, entities, logos, webTitles);

    // Optional LLM text-only cleanup when too generic
    if (useLLM && identity.canonical_name === 'Unknown Card') {
      const json = await llmNormalize(ocrText, logos, webTitles);
      if (json) {
        identity = {
          ...identity,
          player: json.player || identity.player,
          set: json.set || identity.set,
          year: json.year || identity.year,
          card_number: json.card_number || identity.card_number,
          variant: json.variant || identity.variant,
        };
        identity.canonical_name = [identity.player, identity.set].filter(Boolean).join(' — ') || identity.canonical_name;
        identity.query = [identity.year, identity.set, identity.player, identity.card_number, identity.variant]
          .filter(Boolean).join(' ') || identity.query;
      }
    }

    return new Response(JSON.stringify({
      identity,
      ocr_text_debug: ocrText.slice(0, 6000),
      web_titles_debug: webTitles,
      web_entities_debug: entities.slice(0,8),
      logos_debug: logos.slice(0,5)
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' }});

  } catch (e: any) {
    console.error('[analyze] fatal', e?.message || e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...cors, 'Content-Type':'application/json' }});
  }
}
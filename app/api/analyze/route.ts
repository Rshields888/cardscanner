export const runtime = 'nodejs';

import vision from '@google-cloud/vision';
import { fixPk, pickEnv, envDiag } from '@/lib/env';

type Body = { imageDataUrl?: string; variants?: string[] };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

// ---- Config ----
const SETS = [
  'Topps','Topps Chrome','Topps Chrome Update','Bowman','Bowman Chrome','Bowman Draft',
  'Panini','Prizm','Prizm Draft Picks','Optic','Donruss','Select','Mosaic','Score','Leaf',
  'Allen & Ginter','Heritage','Stadium Club','Finest','Spectra','Contenders','Absolute'
];

// Optional text-only fallback (no image sent)
const USE_LLM = !!process.env.USE_LLM_FALLBACK && !!process.env.OPENAI_API_KEY;

// ---- Helpers ----
async function toBuf(dataUrl: string): Promise<Buffer> {
  if (!/^data:image\/(png|jpe?g);base64,/.test(dataUrl)) throw new Error('imageDataUrl/variant must be base64 data URL');
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
async function enhance(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  let s = sharp(buf);
  if ((meta.height ?? 0) < 900) s = s.resize({ height: 1300, withoutEnlargement: false });
  return await s.normalize().gamma(1.1).sharpen(0.8).jpeg({ quality: 95 }).toBuffer();
}
type Rect = { left:number; top:number; width:number; height:number };
function frac(meta:{width?:number;height?:number}, f:{x:number;y:number;w:number;h:number}): Rect {
  const W = meta.width ?? 0, H = meta.height ?? 0;
  return { left: Math.max(0,Math.round(W*f.x)), top: Math.max(0,Math.round(H*f.y)),
           width: Math.max(1,Math.round(W*f.w)), height: Math.max(1,Math.round(H*f.h)) };
}
async function sliceROIs(buf: Buffer) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  const full: Rect = { left:0, top:0, width:meta.width!, height:meta.height! };
  const name = frac(meta,{ x:0.06, y:0.68, w:0.88, h:0.30 }); // bottom band
  const logo = frac(meta,{ x:0.08, y:0.02, w:0.84, h:0.22 }); // top band
  async function cut(r:Rect) {
    return sharp(buf).extract(r).resize({ height: Math.min(1100, Math.max(740, r.height)) })
      .jpeg({ quality: 96 }).toBuffer();
  }
  return { full: await cut(full), name: await cut(name), logo: await cut(logo) };
}
function newClient() {
  const diag = envDiag();
  if (!diag.ok) throw new Error('MISSING_ENV: ' + diag.missing.join(','));
  return new vision.ImageAnnotatorClient({
    projectId: pickEnv('GOOGLE_PROJECT_ID','GCP_PROJECT_ID'),
    credentials: { client_email: pickEnv('GOOGLE_CLIENT_EMAIL','GCP_CLIENT_EMAIL') || '',
                   private_key: fixPk(pickEnv('GOOGLE_PRIVATE_KEY','GCP_PRIVATE_KEY')) },
  });
}
async function annotate(client: any, buf: Buffer) {
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
function parseIdentity(text: string, entities: {text:string,score:number}[], logos:string[], titles:string[]) {
  const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
  const card = (text.match(/\b(?:No\.|No|#|№)\s*([A-Z0-9-]+)\b/i) || [])[1] || '';
  const variant = /\bRC\b/.test(text) ? 'RC' : '';
  const set = ((): string => {
    // prefer multi-word sets first
    const sorted = [...SETS].sort((a,b)=>b.length-a.length);
    for (const s of sorted) if (new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\\]{}]/g,'\\$&')}\\b`,'i').test(text)) return s;
    return logos[0] || '';
  })();
  const ocrNames = (text.match(/\b[A-Z][a-z]+ [A-Z][a-z-']+\b/g) || []).filter(n => !SETS.includes(n.split(' ')[0]));
  const entityNames = entities.filter(e=>looksLikeName(e.text))
                              .sort((a,b)=>(b.score-a.score)||(b.text.length-a.text.length))
                              .map(e=>e.text);
  const titleName = (titles[0]?.split(/[-–|•]/)[0].trim() || '');
  const player = ocrNames[0] || entityNames[0] || titleName || '';

  const canonical = [player,set].filter(Boolean).join(' — ') || 'Unknown Card';
  const query = [year,set,player,card,variant].filter(Boolean).join(' ') || 'trading card';
  const alt1  = [set,player,card,'RC'].filter(Boolean).join(' ');
  const alt2  = [year,set,player].filter(Boolean).join(' ');
  const score =
    (player ? 40 : 0) +
    (set ? 20 : 0) +
    (year ? 15 : 0) +
    (card ? 20 : 0) +
    (variant ? 5 : 0);

  return {
    canonical_name: canonical, player, set, year,
    card_number: card, variant, grading: null,
    query, alt_queries: [alt1,alt2].filter(Boolean),
    confidence: Math.min(100, score)
  };
}
async function llmNormalize(ocr: string, logos: string[], titles: string[]) {
  if (!USE_LLM || !ocr) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const prompt =
`Extract JSON with keys: player, set, year, card_number, variant ("RC" if rookie).
Use only this OCR text and hints. If unknown, leave empty.

OCR:
${ocr}

LOGOS: ${logos.join(', ')}
TITLES: ${titles.join(' | ')}
Return ONLY minified JSON.`;
    const resp = await client.responses.create({ model: 'gpt-4o-mini', input: prompt, temperature: 0 });
    const text = resp.output_text || '';
    return JSON.parse(text);
  } catch { return null; }
}

// score a variant by parsed fields + OCR token count
function variantScore(id: any, ocrText: string) {
  const tokens = (ocrText.match(/\w+/g) || []).length;
  const fields = (id.player?1:0)+(id.set?1:0)+(id.year?1:0)+(id.card_number?1:0)+(id.variant?0.5:0);
  return fields*20 + Math.min(20, Math.floor(tokens/15)); // cap OCR bonus
}

// ---- Route ----
export async function POST(req: Request) {
  try {
    const diag = envDiag();
    if (!diag.ok) return new Response(JSON.stringify({ error:'MISSING_ENV', detail: diag.missing }),
      { status: 500, headers: { ...cors, 'Content-Type':'application/json' } });

    const { imageDataUrl, variants }: Body = await req.json();
    const inputs = (variants?.length ? variants : (imageDataUrl ? [imageDataUrl] : []));
    if (!inputs.length) return new Response(JSON.stringify({ error:'imageDataUrl or variants[] required' }),
      { status: 422, headers: { ...cors, 'Content-Type':'application/json' } });

    const client = newClient();

    let best = { idx: -1, identity: null as any, ocr: '', titles: [] as string[], logos: [] as string[], entities: [] as {text:string,score:number}[], score: -1 };

    for (let i=0;i<inputs.length;i++){
      // preprocess
      let buf = await toBuf(inputs[i]);
      buf = await enhance(buf);
      const rois = await sliceROIs(buf);

      // annotate all ROIs
      const [aFull, aName, aLogo] = await Promise.all([
        annotate(client, rois.full), annotate(client, rois.name), annotate(client, rois.logo)
      ]);

      // merge text + signals
      const ocrText = [
        aFull.fullTextAnnotation?.text || '',
        aName.fullTextAnnotation?.text || '',
        aLogo.fullTextAnnotation?.text || '',
      ].join('\n');

      const titles = [
        ...(aFull.webDetection?.pagesWithMatchingImages || []),
        ...(aName.webDetection?.pagesWithMatchingImages || []),
        ...(aLogo.webDetection?.pagesWithMatchingImages || []),
      ].map(p => (p.pageTitle || '').trim()).filter(Boolean).slice(0,7);

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

      let identity = parseIdentity(ocrText, entities, logos, titles);

      // optional text-only cleanup
      if (USE_LLM && identity.canonical_name === 'Unknown Card') {
        const j = await llmNormalize(ocrText, logos, titles);
        if (j) {
          identity = {
            ...identity,
            player: j.player || identity.player,
            set: j.set || identity.set,
            year: j.year || identity.year,
            card_number: j.card_number || identity.card_number,
            variant: j.variant || identity.variant,
          };
          identity.canonical_name = [identity.player, identity.set].filter(Boolean).join(' — ') || identity.canonical_name;
          identity.query = [identity.year, identity.set, identity.player, identity.card_number, identity.variant]
            .filter(Boolean).join(' ') || identity.query;
        }
      }

      const s = variantScore(identity, ocrText);
      if (s > best.score) best = { idx: i, identity, ocr: ocrText, titles, logos, entities, score: s };
    }

    return new Response(JSON.stringify({
      identity: best.identity,
      chosen_variant: (best.idx < 0 ? 0 : best.idx),
      ocr_text_debug: best.ocr.slice(0, 6000),
      web_titles_debug: best.titles.slice(0, 8),
      web_entities_debug: best.entities.slice(0, 10),
      logos_debug: best.logos.slice(0, 8),
    }), { status: 200, headers: { ...cors, 'Content-Type':'application/json' } });

  } catch (e:any) {
    console.error('[analyze] fatal', e?.message || e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...cors, 'Content-Type':'application/json' } });
  }
}
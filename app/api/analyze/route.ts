export const runtime = 'nodejs';

import vision from '@google-cloud/vision';
import { fixPk, pickEnv, envDiag } from '@/lib/env';

type Body = { imageDataUrl?: string };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

const SETS = [
  'Topps','Bowman','Panini','Prizm','Chrome','Optic','Donruss',
  'Select','Mosaic','Score','Leaf','Allen & Ginter','Heritage',
  'Stadium Club','Finest','Spectra','Contenders','Absolute'
];

// ---- image helpers (server-side ROI slicing with sharp)
async function decodeBase64(dataUrl: string): Promise<Buffer> {
  if (!/^data:image\/(jpe?g|png);base64,/.test(dataUrl)) throw new Error('imageDataUrl must be base64 data URL');
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function upscaleAndNormalize(buf: Buffer): Promise<Buffer> {
  // Upscale small screenshots, normalize contrast, light sharpen
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();
  let s = sharp(buf);
  if ((meta.height ?? 0) < 900) s = s.resize({ height: 1300, withoutEnlargement: false });
  s = s
    .normalize()           // improve contrast
    .gamma(1.1)            // mild gamma
    .sharpen(0.8)          // small sharpen
    .jpeg({ quality: 92 });
  return await s.toBuffer();
}

type Rect = { left: number; top: number; width: number; height: number; };

function fracRect(meta: { width?: number; height?: number; }, f: { x:number;y:number;w:number;h:number; }): Rect {
  const W = meta.width ?? 0, H = meta.height ?? 0;
  return {
    left: Math.max(0, Math.round(W * f.x)),
    top:  Math.max(0, Math.round(H * f.y)),
    width: Math.max(1, Math.round(W * f.w)),
    height: Math.max(1, Math.round(H * f.h)),
  };
}

async function extractROIs(buf: Buffer) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buf).metadata();

  // Full (tight crop already), Nameplate (bottom 30%), Logo band (top ~20% center)
  const full: Rect = { left: 0, top: 0, width: meta.width!, height: meta.height! };
  const nameplate = fracRect(meta, { x: 0.06, y: 0.68, w: 0.88, h: 0.30 }); // bottom band
  const logoBand  = fracRect(meta, { x: 0.08, y: 0.02, w: 0.84, h: 0.22 }); // top logos/text

  async function cut(r: Rect) {
    const b = await sharp(buf).extract(r).resize({ height: Math.min(1100, Math.max(700, r.height)) }).jpeg({ quality: 94 }).toBuffer();
    return b;
  }

  return {
    full: await cut(full),
    nameplate: await cut(nameplate),
    logo: await cut(logoBand),
  };
}

// ---- Vision client + annotate
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

async function visionAnnotate(client: any, buf: Buffer) {
  const [annot] = await client.annotateImage({
    image: { content: buf },
    features: [
      { type: 'DOCUMENT_TEXT_DETECTION' },
      { type: 'WEB_DETECTION' },
      { type: 'LOGO_DETECTION' },
    ],
    imageContext: { languageHints: ['en'] },
  });
  return annot;
}

// ---- parsing
function parseIdentity(text: string, webTitles: string[], logos: string[]) {
  const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
  const cardNum = (text.match(/\b(?:No\.|No|#|№)\s*([A-Z0-9-]+)\b/i) || [])[1] || '';
  const variant = /\bRC\b/.test(text) ? 'RC' : '';
  const set = SETS.find(s => new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\\]{}]/g,'\\$&')}\\b`, 'i').test(text))
             || (logos[0] || '');

  // Candidate names like "First Last" or "First Last-Suffix"
  const nameCandidates = (text.match(/\b[A-Z][a-z]+ [A-Z][a-z-']+\b/g) || [])
    .filter(n => !SETS.includes(n.split(' ')[0]));
  const player =
    nameCandidates.sort((a,b)=>b.length-a.length)[0] ||
    (webTitles[0]?.split(/[-–|•]/)[0].trim() || '');

  const canonical = [player, set].filter(Boolean).join(' — ') || 'Unknown Card';
  const query = [year, set, player, cardNum, variant].filter(Boolean).join(' ') || 'trading card';
  const alt1  = [set, player, cardNum, 'RC'].filter(Boolean).join(' ');
  const alt2  = [year, set, player].filter(Boolean).join(' ');

  return {
    canonical_name: canonical,
    player, set, year,
    card_number: cardNum,
    variant,
    grading: null,
    query,
    alt_queries: [alt1, alt2].filter(Boolean),
  };
}

// ---- route
export async function POST(req: Request) {
  try {
    const { imageDataUrl }: Body = await req.json();
    if (!imageDataUrl) {
      return new Response(JSON.stringify({ error: 'imageDataUrl required' }), { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // decode + preprocess + slice ROIs
    let buf = await decodeBase64(imageDataUrl);
    buf = await upscaleAndNormalize(buf);
    const rois = await extractROIs(buf);

    // annotate all three
    const client = newClient();
    const [aFull, aName, aLogo] = await Promise.all([
      visionAnnotate(client, rois.full),
      visionAnnotate(client, rois.nameplate),
      visionAnnotate(client, rois.logo),
    ]);

    const texts = [
      aFull.fullTextAnnotation?.text || '',
      aName.fullTextAnnotation?.text || '',
      aLogo.fullTextAnnotation?.text || '',
    ].join('\n');

    // merge signals
    const webTitles = [
      ...(aFull.webDetection?.pagesWithMatchingImages || []),
      ...(aName.webDetection?.pagesWithMatchingImages || []),
      ...(aLogo.webDetection?.pagesWithMatchingImages || []),
    ].map(p => (p.pageTitle || '').trim()).filter(Boolean).slice(0, 5);

    const logos = [
      ...(aFull.logoAnnotations || []),
      ...(aName.logoAnnotations || []),
      ...(aLogo.logoAnnotations || []),
    ].map(l => l.description).filter(Boolean);

    const identity = parseIdentity(texts, webTitles, logos);

    return new Response(JSON.stringify({
      identity: {
        ...identity,
        ocr_text_debug: texts.slice(0, 6000),
        web_titles_debug: webTitles,
        logos_debug: logos.slice(0, 5),
      }
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('[analyze] fatal', e?.message || e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
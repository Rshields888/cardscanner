export const runtime = 'nodejs';
import vision from '@google-cloud/vision';
import { fixPk, pickEnv, envDiag } from '@/lib/env';

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
export async function OPTIONS(){ return new Response(null,{status:204,headers:cors}); }

type Body = { imageDataUrl?: string };

async function maybeUpscale(b64: string){ try{ const sharp=(await import('sharp')).default;
  const buf=Buffer.from(b64,'base64'); const meta=await sharp(buf).metadata(); const h=meta.height??0;
  if(h<800){ const out=await sharp(buf).resize({height:1200}).jpeg({quality:92}).toBuffer(); return out.toString('base64'); }
  return b64; } catch { return b64; } }

function parseIdentity(text:string, webTitles:string[], logos:string[]){
  const SETS=['Topps','Bowman','Panini','Prizm','Chrome','Select','Mosaic','Optic','Donruss','Score','Leaf','Allen & Ginter','Heritage','Stadium Club','Finest'];
  const year=(text.match(/\b(19|20)\d{2}\b/)||[])[0]||'';
  const card=(text.match(/\b(?:No\.|No|#|№)\s*([A-Z0-9-]+)\b/i)||[])[1]||'';
  const variant=/\bRC\b/.test(text)?'RC':'';
  const set=SETS.find(s=>new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\\]{{}}]/g,'\\$&')}\\b`,'i').test(text))||logos[0]||'';
  const names=(text.match(/\b[A-Z][a-z]+ [A-Z][a-z-']+\b/g)||[]); const player=names.sort((a,b)=>b.length-a.length)[0]||(webTitles[0]?.split(/[-–|•]/)[0].trim()||'');
  const canonical=[player,set].filter(Boolean).join(' — ')||'Unknown Card';
  const query=[year,set,player,card,variant].filter(Boolean).join(' ')||'trading card';
  const alt1=[set,player,card,'RC'].filter(Boolean).join(' '); const alt2=[year,set,player].filter(Boolean).join(' ');
  return { canonical_name:canonical, player, set, year, card_number:card, variant, grading:null, query, alt_queries:[alt1,alt2].filter(Boolean) };
}

export async function POST(req: Request){
  try{
    const d=envDiag(); if(!d.ok) return new Response(JSON.stringify({error:'MISSING_ENV', detail:d.missing}),{status:500,headers:{...cors,'Content-Type':'application/json'}});
    const { imageDataUrl }: Body = await req.json();
    if(!imageDataUrl || !/^data:image\/(jpe?g|png);base64,/.test(imageDataUrl)) return new Response(JSON.stringify({error:'imageDataUrl required'}),{status:422,headers:{...cors,'Content-Type':'application/json'}});
    let b64=imageDataUrl.split(',')[1]; b64=await maybeUpscale(b64);

    const client = new vision.ImageAnnotatorClient({
      projectId: pickEnv('GOOGLE_PROJECT_ID','GCP_PROJECT_ID'),
      credentials: {
        client_email: pickEnv('GOOGLE_CLIENT_EMAIL','GCP_CLIENT_EMAIL'),
        private_key: fixPk(pickEnv('GOOGLE_PRIVATE_KEY','GCP_PRIVATE_KEY')),
      },
    });

    const [annot] = await client.annotateImage({
      image: { content: Buffer.from(b64,'base64') },
      features: [{type:'DOCUMENT_TEXT_DETECTION'},{type:'WEB_DETECTION'},{type:'LOGO_DETECTION'}],
      imageContext: { languageHints:['en'] },
    });

    const text = annot.fullTextAnnotation?.text || '';
    const webTitles = (annot.webDetection?.pagesWithMatchingImages||[]).map(p=> (p.pageTitle||'').trim()).filter(Boolean).slice(0,5);
    const logos = (annot.logoAnnotations||[]).map(l=> l.description).filter(Boolean);
    const identity = parseIdentity(text, webTitles, logos);

    return new Response(JSON.stringify({ identity: { ...identity, ocr_text_debug: text.slice(0,5000), web_titles_debug: webTitles } }), { status:200, headers:{...cors,'Content-Type':'application/json'} });
  } catch(e:any){
    console.error('[analyze] fatal', e?.message||e); 
   return new Response(JSON.stringify({ error:String(e?.message||e) }), { status:500, headers:{...cors,'Content-Type':'application/json'} });
  }
}
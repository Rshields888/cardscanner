
import vision from "@google-cloud/vision";
import { findCompletedComps } from "@/lib/ebay";

export const runtime = 'nodejs';
export const maxDuration = 15;

function ensureEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizePrivateKey(pk: string|undefined) {
  return pk ? pk.replace(/\\n/g, "\n") : "";
}

function buildQueryFromText(text: string) {
  const lower = text.toLowerCase();
  const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
  const brands = ["topps","panini","prizm","mosaic","optic","select","donruss","bowman","chrome","fleer","upper deck","score","prizim"];
  const brand = brands.find(b => lower.includes(b)) || "";
  const numMatch = lower.match(/#\s?([0-9]{1,4}[a-z]?)/) || lower.match(/no\.\s?([0-9]{1,4}[a-z]?)/);
  const nameMatch = (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g) || [])
    .sort((a,b)=>b.length - a.length)[0] || "";
  const flags = [];
  if (/\b(rc|rookie)\b/i.test(text)) flags.push("RC");
  if (/\b(psa\s*10|psa\s*9|bgs|sgc)\b/i.test(text)) flags.push("graded");
  if (/\b(silver|holo|refractor)\b/i.test(text)) flags.push("silver");
  const parts = [yearMatch?.[0], brand, nameMatch, (numMatch ? ("#" + numMatch[1]) : ""), ...flags].filter(Boolean);
  const q = parts.join(" ").replace(/\s+/g, " ").trim();
  return q || text.split("\n")[0];
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const image = form.get("image");
    if (!image || !(image instanceof Blob)) {
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 });
    }
    const arrayBuf = await image.arrayBuffer();
    const content = Buffer.from(arrayBuf);

    const projectId = ensureEnv("GOOGLE_PROJECT_ID");
    const clientEmail = ensureEnv("GOOGLE_CLIENT_EMAIL");
    const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

    const client = new vision.ImageAnnotatorClient({
      projectId,
      credentials: { client_email: clientEmail, private_key: privateKey }
    });

    const [result] = await client.textDetection({ image: { content } });
    const text = result?.fullTextAnnotation?.text || "";
    const query = buildQueryFromText(text);

    const appId = ensureEnv("EBAY_APP_ID");
    const comps = await findCompletedComps(query, appId);

    const payload = { title: query, comps, ocrText: text?.slice(0, 1000) || null };
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  } catch (e:any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message || "scan failed" }), { status: 500 });
  }
}

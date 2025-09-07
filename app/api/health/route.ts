export const runtime = 'nodejs';
import { envDiag } from '@/lib/env';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
export async function OPTIONS(){ return new Response(null,{status:204,headers:cors}); }
export async function GET(){ const d=envDiag(); return new Response(JSON.stringify({ok:true, env:d}),{status:200,headers:{...cors,'Content-Type':'application/json'}}); }
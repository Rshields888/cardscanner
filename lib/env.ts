export function pickEnv(...keys: string[]) {
  for (const k of keys) if (process.env[k]) return process.env[k]!;
  return '';
}
export function fixPk(pk?: string) {
  return (pk || '').replace(/\r/g, '').replace(/\\n/g, '\n');
}
export function envDiag() {
  const fields = [
    ['projectId', ['GOOGLE_PROJECT_ID','GCP_PROJECT_ID']],
    ['clientEmail', ['GOOGLE_CLIENT_EMAIL','GCP_CLIENT_EMAIL']],
    ['privateKey', ['GOOGLE_PRIVATE_KEY','GCP_PRIVATE_KEY']],
  ] as const;
  const missing: string[] = [];
  const out: Record<string,string> = {};
  for (const [label, opts] of fields) {
    const v = pickEnv(...opts);
    if (!v) missing.push(opts.join('|'));
    out[label] = v ? '[set]' : '';
  }
  return { ok: missing.length===0, missing, map: out };
}

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
  for (const [, opts] of fields) if (!pickEnv(...opts)) missing.push(opts.join('|'));
  return { ok: missing.length===0, missing };
}

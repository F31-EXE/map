// Health check of the live Firestore with the service account (GOOGLE_APPLICATION_CREDENTIALS):
// a test write and read of `_diag/ping`, and — if the account may read Cloud Monitoring —
// the document writes and reads of the last 24 h, to spot an exhausted free quota
// (Spark plan: 20 000 writes / 50 000 reads per day), under which writes from the apps hang.
// Usage: node scripts/firestore-check.mjs <projectId>
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const project = process.argv[2];
const key = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
const b64 = (s) => Buffer.from(s).toString('base64url');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(
    JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: key.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    })
  );
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key.private_key, 'base64url');
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await accessToken();
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const doc = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/_diag/ping`;

const show = async (label, res) => {
  const text = await res.text();
  console.log(`${label}: HTTP ${res.status} ${text.slice(0, 400).replace(/\s+/g, ' ')}`);
};

await show('write', await fetch(doc, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: { at: { timestampValue: new Date().toISOString() } } }) }));
await show('read', await fetch(doc, { headers: H }));
await show('delete', await fetch(doc, { method: 'DELETE', headers: H }));

// Usage over the last 24 h (needs monitoring.viewer; skipped quietly otherwise).
const end = new Date();
const start = new Date(end.getTime() - 24 * 3600_000);
for (const metric of ['document/write_count', 'document/read_count', 'document/delete_count']) {
  const q = new URLSearchParams({
    filter: `metric.type="firestore.googleapis.com/${metric}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  const res = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${q}`, { headers: H });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`${metric} (24 h): no access (${res.status} ${json.error?.status ?? ''})`);
    continue;
  }
  const total = (json.timeSeries ?? []).flatMap((s) => s.points ?? []).reduce((n, p) => n + Number(p.value?.int64Value ?? 0), 0);
  console.log(`${metric} (24 h): ${total}`);
}

// Publishes firestore.rules through the Firebase Rules API with a service account key
// (GOOGLE_APPLICATION_CREDENTIALS). Same two calls `firebase deploy --only firestore:rules`
// makes, minus its "is the API enabled" check, which the default Firebase Admin SDK
// service account isn't allowed to run.
// Usage: node scripts/deploy-rules.mjs <projectId>
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const project = process.argv[2];
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!project || !keyFile) {
  console.error('usage: GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/deploy-rules.mjs <projectId>');
  process.exit(2);
}
const key = JSON.parse(readFileSync(keyFile, 'utf8'));

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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claims}.${sig}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await accessToken();
const api = `https://firebaserules.googleapis.com/v1/projects/${project}`;
const call = async (method, path, body) => {
  const res = await fetch(api + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

// 1. Upload the rules as a new ruleset (the server compiles and rejects bad rules here).
const ruleset = await call('POST', '/rulesets', {
  source: { files: [{ name: 'firestore.rules', content: readFileSync('firestore.rules', 'utf8') }] },
});
if (!ruleset.ok) {
  console.error(`ruleset: ${ruleset.status} ${JSON.stringify(ruleset.json)}`);
  process.exit(1);
}
const rulesetName = ruleset.json.name;
console.log('created', rulesetName);

// 2. Point the default Firestore database at it.
const release = `projects/${project}/releases/cloud.firestore`;
let rel = await call('PATCH', '/releases/cloud.firestore', { release: { name: release, rulesetName } });
if (rel.status === 404) rel = await call('POST', '/releases', { name: release, rulesetName });
if (!rel.ok) {
  console.error(`release: ${rel.status} ${JSON.stringify(rel.json)}`);
  process.exit(1);
}
console.log('released', rel.json.name, '→', rel.json.rulesetName);

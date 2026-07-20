const http = require('http');
const os = require('os');
const { DigestAuth } = require('./digest-auth');

const INFINISPAN_URL = process.env.INFINISPAN_URL || 'http://infinispan:11222';
const CACHE_NAME = process.env.CACHE_NAME || 'sessions';
const USERNAME = process.env.INFINISPAN_USER || 'admin';
const PASSWORD = process.env.INFINISPAN_PASS || 'changeme';

const auth = new DigestAuth(USERNAME, PASSWORD);

async function ensureCache() {
  const res = await auth.fetch(`${INFINISPAN_URL}/rest/v2/caches/${CACHE_NAME}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'distributed-cache': { mode: 'SYNC' } }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`failed to create cache: ${res.status} ${await res.text()}`);
  }
}

async function bumpSession(sessionId) {
  const key = encodeURIComponent(sessionId);
  const getRes = await auth.fetch(`${INFINISPAN_URL}/rest/v2/caches/${CACHE_NAME}/${key}`);
  const count = (getRes.status === 200 ? parseInt(await getRes.text(), 10) || 0 : 0) + 1;

  const putRes = await auth.fetch(`${INFINISPAN_URL}/rest/v2/caches/${CACHE_NAME}/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: String(count),
  });
  if (!putRes.ok) {
    throw new Error(`failed to write session: ${putRes.status} ${await putRes.text()}`);
  }
  return count;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200);
    return res.end('ok');
  }

  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session') || 'default';

  try {
    const count = await bumpSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessionId, count, servedBy: os.hostname() }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

ensureCache()
  .then(() => server.listen(8080, () => console.log('session-app listening on 8080')))
  .catch((err) => {
    console.error('failed to initialize infinispan cache', err);
    process.exit(1);
  });

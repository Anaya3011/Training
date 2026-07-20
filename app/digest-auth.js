const crypto = require('crypto');

// Infinispan's REST API only enables HTTP Digest auth by default (no plain
// Basic), so this implements RFC 7616 digest by hand instead of pulling in a
// dependency for it.

function hash(algorithm, text) {
  const alg = algorithm && algorithm.toUpperCase().includes('SHA-256') ? 'sha256' : 'md5';
  return crypto.createHash(alg).update(text).digest('hex');
}

function parseChallenge(header) {
  const params = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match;
  while ((match = re.exec(header)) !== null) {
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return params;
}

class DigestAuth {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.challenge = null;
    this.nonceCount = 0;
    // Concurrent requests sharing one nonce/nc counter can reach the server
    // out of order (network reordering under load), which Infinispan rejects
    // as a stale/replayed nonce. Serializing keeps send order == nc order.
    this.queue = Promise.resolve();
  }

  buildAuthorizationHeader(method, requestUri) {
    const c = this.challenge;
    this.nonceCount += 1;
    const nc = String(this.nonceCount).padStart(8, '0');
    const cnonce = crypto.randomBytes(8).toString('hex');
    const algorithm = c.algorithm || 'MD5';
    const ha1 = hash(algorithm, `${this.username}:${c.realm}:${this.password}`);
    const ha2 = hash(algorithm, `${method}:${requestUri}`);
    const qop = c.qop ? c.qop.split(',')[0].trim() : undefined;
    const response = qop
      ? hash(algorithm, `${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : hash(algorithm, `${ha1}:${c.nonce}:${ha2}`);

    let header = `Digest username="${this.username}", realm="${c.realm}", nonce="${c.nonce}", uri="${requestUri}", response="${response}", algorithm="${algorithm}"`;
    if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (c.opaque) header += `, opaque="${c.opaque}"`;
    return header;
  }

  fetch(url, options = {}) {
    // Chain onto the queue so concurrent callers' nonce/nc values are
    // generated and sent in the same order, never interleaved.
    const run = this.queue.then(() => this._fetch(url, options));
    this.queue = run.catch(() => {});
    return run;
  }

  async _fetch(url, options = {}) {
    const parsed = new URL(url);
    const requestUri = parsed.pathname + parsed.search;
    const method = options.method || 'GET';
    const send = (headers) => fetch(url, { ...options, headers: { ...options.headers, ...headers } });

    if (this.challenge) {
      const res = await send({ Authorization: this.buildAuthorizationHeader(method, requestUri) });
      if (res.status !== 401) return res;
    }

    const probe = await send({});
    if (probe.status !== 401) return probe;

    const wwwAuth = probe.headers.get('www-authenticate');
    this.challenge = parseChallenge(wwwAuth);
    this.nonceCount = 0;
    return send({ Authorization: this.buildAuthorizationHeader(method, requestUri) });
  }
}

module.exports = { DigestAuth };

import https from 'node:https';

/*
 * Minimal `fetch` stand-in for API hosts whose certificate no longer lists
 * their own hostname.
 *
 * Powdr sold Killington and Pico, then dropped both domains from the wildcard
 * certificate their shared load balancer still serves. The endpoints keep
 * returning correct data, but `api.killington.com` and `api.picomountain.com`
 * are answered by a cert naming only *.powdr.com and its siblings, so Node
 * rejects the connection on hostname mismatch.
 *
 * The CA chain is still verified in full - only the hostname match is skipped
 * - so an untrusted or self-signed certificate is still rejected.
 *
 * Returns just the slice of the Response interface that rest.js consumes.
 */
export default function relaxedFetch(url, { headers, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      // fetch drops headers with an undefined value, node:https throws on them
      headers: Object.fromEntries(Object.entries(headers ?? {}).filter(([, v]) => v !== undefined)),
      checkServerIdentity: () => undefined
    };
    const req = https.request(url, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(JSON.parse(text))
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

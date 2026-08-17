import { parseHtml } from './parser.js';
import relaxedFetch from './relaxed-fetch.js';

const userAgent = 'liftie/1.0.0 (https://liftie.info)';

export default function rest(url, parse, fn) {
  const fullUrl = new URL(url.pathname, url.host);
  if (url.query) {
    fullUrl.search = new URLSearchParams(url.query).toString();
  }
  const reqInit = {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json'
    }
  };
  if (url.body) {
    reqInit.body = JSON.stringify(url.body);
    reqInit.method = 'POST';
  }

  // Some hosts serve a certificate that no longer names them - see relaxed-fetch.js
  const request = url.allowHostnameMismatch ? relaxedFetch : fetch;

  request(fullUrl, reqInit)
    .then(async res => {
      if (res.status < 200 || res.status >= 300) {
        return fn(res.status);
      }
      if (url.html) {
        return parseHtml(await res.text(), parse, fn);
      }
      const body = await res.json();
      if (parse.isAsync) {
        parse(body, fn);
      } else {
        fn(null, parse(body));
      }
    })
    .catch(fn);
}

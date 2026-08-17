import Debug from 'debug';
import { parseHtml } from './parser.js';

const debug = Debug('liftie:lifts:browser');

/*
 * Fetch a page through a headless browser, for resorts sitting behind a
 * Cloudflare JS challenge. Those return 403 with `cf-mitigated: challenge` to
 * anything that cannot run JavaScript, so neither plain fetch nor a TLS
 * impersonating client can reach them.
 *
 * Opt in from resort.json by setting `browser` on the url:
 *
 *   "url": {
 *     "host": "https://goremountain.com",
 *     "pathname": "/the-mountain/conditions/",
 *     "browser": true,
 *     "waitFor": ".lifts-row"
 *   }
 *
 * Starting Chrome costs a few hundred MB, so fetches are serialized and the
 * page is cached for `minInterval`. Without that the regular one minute
 * refresh would launch a browser every minute per resort.
 */

const DEFAULT_MIN_INTERVAL = 15 * 60 * 1000;
const NAVIGATION_TIMEOUT = 90 * 1000;

// A browser is opened per fetch and closed straight after, rather than kept
// warm, so an idle resort costs nothing.
const launchOptions = {
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
};

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map();

// Only ever run one browser at a time - two concurrent Chromes are enough to
// exhaust a small VPS.
let queue = Promise.resolve();

async function render(href, waitFor) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    debug('navigating to %s', href);
    await page.goto(href, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: NAVIGATION_TIMEOUT });
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

export default function browserFetch(url, parse, fn) {
  const href = new URL(url.pathname, url.host).href;
  const minInterval = url.minInterval ?? DEFAULT_MIN_INTERVAL;
  const cached = cache.get(href);

  if (cached && Date.now() - cached.at < minInterval) {
    debug('serving cached page for %s', href);
    return parseHtml(cached.html, parse, fn);
  }

  queue = queue
    .then(() => render(href, url.waitFor))
    .then(html => {
      cache.set(href, { at: Date.now(), html });
      parseHtml(html, parse, fn);
    })
    .catch(err => {
      console.error('Browser fetch failed', href, err.message);
      // Fall back to the last good page so a transient failure does not empty
      // out a resort that was working a moment ago.
      if (cached) {
        return parseHtml(cached.html, parse, fn);
      }
      fn(err);
    });
}

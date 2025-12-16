import Debug from 'debug';
import { parseDocument } from 'htmlparser2';
import select from '../../select.js';
import * as domutil from '../../tools/domutil.js';

const debug = Debug('liftie:resort:whiteface');

// Use a real Chrome User-Agent to bypass ORDA blocking
const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const whitefaceUrl = 'https://whiteface.com/mountain/conditions/';

// Parser configuration for ORDA conditions plugin
const parseConfig = {
  name: '1',
  status: {
    child: '2/0',
    attribute: 'src',
    regex: /icon-(.+).svg$/
  }
};

/**
 * Parser for Whiteface.
 * Works in two modes:
 * - Sync mode (for tests): If DOM has .lifts-row elements, parse and return immediately
 * - Async mode (for production when blocked): If DOM is empty, fetch with Chrome UA
 * 
 * The parser detects mode by checking if fn callback is provided
 */
export default function parse(dom, fn) {
  // Try to parse the provided DOM first
  const lifts = select(dom, '.lifts-row');

  if (lifts.length > 0) {
    // DOM has lift data - parse it normally (sync mode for tests)
    debug('Parsing provided DOM with %d lifts', lifts.length);
    const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);
    debug('Whiteface Lift Status:', liftStatus);

    // If callback provided, use it; otherwise return directly (for sync tests)
    if (typeof fn === 'function') {
      return fn(null, liftStatus);
    }
    return liftStatus;
  }

  // No lift data in DOM - do our own fetch with Chrome UA (async mode)
  debug('No lift data in DOM, fetching with Chrome UA');

  // If no callback, we can't do async - return empty
  if (typeof fn !== 'function') {
    debug('No callback provided, returning empty result');
    return {};
  }

  fetchWithChromeUA(fn);
}

function fetchWithChromeUA(fn) {
  fetch(whitefaceUrl, {
    headers: {
      'User-Agent': chromeUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  })
    .then(async res => {
      if (res.status < 200 || res.status >= 300) {
        debug('Whiteface fetch error: %d', res.status);
        return fn(null, {});
      }
      const html = await res.text();
      const dom = parseDocument(html);
      const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);
      debug('Whiteface Lift Status (via Chrome UA):', liftStatus);
      fn(null, liftStatus);
    })
    .catch(err => {
      debug('Whiteface fetch exception:', err);
      fn(null, {});
    });
}

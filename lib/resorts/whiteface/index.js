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

// Rate limiting: 5-15 minute random intervals
const MIN_FETCH_INTERVAL = 5 * 60 * 1000;  // 5 minutes
const MAX_FETCH_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Operating hours in NY timezone (EST/EDT)
// Whiteface: typically 8:30 AM - 4:00 PM
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17; // 5 PM to account for closing operations

// State for rate limiting
let lastFetchTime = 0;
let cachedStatus = {};
let nextFetchInterval = getRandomInterval();

function getRandomInterval() {
  return MIN_FETCH_INTERVAL + Math.random() * (MAX_FETCH_INTERVAL - MIN_FETCH_INTERVAL);
}

function isWithinOperatingHours() {
  // Get current time in NY timezone
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nyTime.getHours();
  const day = nyTime.getDay(); // 0 = Sunday, 6 = Saturday

  // Check if it's during operating hours (any day during ski season)
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function shouldFetch() {
  const now = Date.now();
  const timeSinceLastFetch = now - lastFetchTime;

  // Always allow first fetch
  if (lastFetchTime === 0) {
    return true;
  }

  // Check rate limit
  if (timeSinceLastFetch < nextFetchInterval) {
    debug('Rate limited: %d ms until next fetch', nextFetchInterval - timeSinceLastFetch);
    return false;
  }

  // Check operating hours
  if (!isWithinOperatingHours()) {
    debug('Outside operating hours, using cached data');
    return false;
  }

  return true;
}

/**
 * Parser for Whiteface.
 * Works in two modes:
 * - Sync mode (for tests): If DOM has .lifts-row elements, parse and return immediately
 * - Async mode (for production): Rate-limited fetch with Chrome UA during operating hours
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

  // No lift data in DOM - check if we should fetch (production mode)
  debug('No lift data in DOM');

  // If no callback, we can't do async - return empty or cached
  if (typeof fn !== 'function') {
    debug('No callback provided, returning cached result');
    return cachedStatus;
  }

  // Check rate limiting and operating hours
  if (!shouldFetch()) {
    debug('Using cached lift status');
    return fn(null, cachedStatus);
  }

  // Fetch with Chrome UA
  debug('Fetching with Chrome UA');
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
      // Update timing regardless of result
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval();
      debug('Next fetch in %d minutes', Math.round(nextFetchInterval / 60000));

      if (res.status < 200 || res.status >= 300) {
        debug('Whiteface fetch error: %d', res.status);
        return fn(null, cachedStatus);
      }
      const html = await res.text();
      const dom = parseDocument(html);
      const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);

      // Cache the result
      cachedStatus = liftStatus;

      debug('Whiteface Lift Status (via Chrome UA):', liftStatus);
      fn(null, liftStatus);
    })
    .catch(err => {
      // Update timing on error too
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval();

      debug('Whiteface fetch exception:', err);
      fn(null, cachedStatus);
    });
}

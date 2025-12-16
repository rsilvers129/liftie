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

// Adaptive rate limiting based on activity
const ACTIVE_MIN_INTERVAL = 5 * 60 * 1000;    // 5 minutes when active
const ACTIVE_MAX_INTERVAL = 15 * 60 * 1000;   // 15 minutes when active
const INACTIVE_MIN_INTERVAL = 30 * 60 * 1000; // 30 minutes when inactive
const INACTIVE_MAX_INTERVAL = 60 * 60 * 1000; // 60 minutes when inactive

// Consider "active" if requests come in faster than every 5 minutes
const ACTIVITY_THRESHOLD = 5 * 60 * 1000;

// Operating hours in NY timezone (EST/EDT)
// Whiteface: typically 8:30 AM - 4:00 PM
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17; // 5 PM to account for closing operations

// State for rate limiting
let lastFetchTime = 0;
let lastRequestTime = 0;
let cachedStatus = {};
let nextFetchInterval = getRandomInterval(false);

function getRandomInterval(isActive) {
  const min = isActive ? ACTIVE_MIN_INTERVAL : INACTIVE_MIN_INTERVAL;
  const max = isActive ? ACTIVE_MAX_INTERVAL : INACTIVE_MAX_INTERVAL;
  return min + Math.random() * (max - min);
}

function isWithinOperatingHours() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nyTime.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function isUserActive() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  return timeSinceLastRequest < ACTIVITY_THRESHOLD;
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
    debug('Rate limited: %d min until next fetch', Math.round((nextFetchInterval - timeSinceLastFetch) / 60000));
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
 * - Sync mode (for tests): If DOM has .lifts-row elements, parse and return immediately
 * - Async mode (production): Adaptive rate limiting based on user activity
 */
export default function parse(dom, fn) {
  // Track request time for activity detection
  lastRequestTime = Date.now();

  // Try to parse the provided DOM first
  const lifts = select(dom, '.lifts-row');

  if (lifts.length > 0) {
    // DOM has lift data - parse it normally (sync mode for tests)
    debug('Parsing provided DOM with %d lifts', lifts.length);
    const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);
    debug('Whiteface Lift Status:', liftStatus);

    if (typeof fn === 'function') {
      return fn(null, liftStatus);
    }
    return liftStatus;
  }

  // No lift data in DOM - production mode
  debug('No lift data in DOM');

  if (typeof fn !== 'function') {
    debug('No callback provided, returning cached result');
    return cachedStatus;
  }

  // Check rate limiting and operating hours
  if (!shouldFetch()) {
    debug('Using cached lift status');
    return fn(null, cachedStatus);
  }

  debug('Fetching with Chrome UA (active=%s)', isUserActive());
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
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Next fetch in %d min (active=%s)', Math.round(nextFetchInterval / 60000), isUserActive());

      if (res.status < 200 || res.status >= 300) {
        debug('Whiteface fetch error: %d', res.status);
        return fn(null, cachedStatus);
      }
      const html = await res.text();
      const dom = parseDocument(html);
      const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);
      cachedStatus = liftStatus;
      debug('Whiteface Lift Status (via Chrome UA):', liftStatus);
      fn(null, liftStatus);
    })
    .catch(err => {
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Whiteface fetch exception:', err);
      fn(null, cachedStatus);
    });
}

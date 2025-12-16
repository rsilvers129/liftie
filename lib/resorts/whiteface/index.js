import Debug from 'debug';
import { parseDocument } from 'htmlparser2';
import select from '../../select.js';
import * as domutil from '../../tools/domutil.js';

const debug = Debug('liftie:resort:whiteface');

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
const ACTIVE_MIN_INTERVAL = 5 * 60 * 1000; // 5 minutes when active
const ACTIVE_MAX_INTERVAL = 15 * 60 * 1000; // 15 minutes when active
const INACTIVE_MIN_INTERVAL = 30 * 60 * 1000; // 30 minutes when inactive
const INACTIVE_MAX_INTERVAL = 60 * 60 * 1000; // 60 minutes when inactive

// Consider "active" if requests come in faster than every 5 minutes
const ACTIVITY_THRESHOLD = 5 * 60 * 1000;

// Operating hours in NY timezone (EST/EDT)
const OPEN_HOUR = 7.75; // 7:45 AM
const CLOSE_HOUR = 17.5; // 5:30 PM

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
  const hour = nyTime.getHours() + nyTime.getMinutes() / 60;
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

  if (lastFetchTime === 0) {
    return true;
  }

  if (timeSinceLastFetch < nextFetchInterval) {
    debug('Rate limited: %d min until next fetch', Math.round((nextFetchInterval - timeSinceLastFetch) / 60000));
    return false;
  }

  if (!isWithinOperatingHours()) {
    debug('Outside operating hours, using cached data');
    return false;
  }

  return true;
}

/**
 * Fetch page using Puppeteer to bypass Cloudflare JS challenge
 */
async function fetchWithPuppeteer() {
  let browser = null;
  try {
    // Dynamic import to avoid loading puppeteer unless needed
    const puppeteer = await import('puppeteer');

    debug('Launching Puppeteer browser');
    browser = await puppeteer.default.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    debug('Navigating to %s', whitefaceUrl);
    await page.goto(whitefaceUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for lift data to appear (Cloudflare challenge should resolve)
    debug('Waiting for lift data');
    await page.waitForSelector('.lifts-row', { timeout: 30000 });

    const html = await page.content();
    await browser.close();
    browser = null;

    debug('Got page content, parsing');
    return html;
  } catch (err) {
    debug('Puppeteer error:', err.message);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

/**
 * Parser for Whiteface.
 * - Sync mode (for tests): If DOM has .lifts-row elements, parse and return immediately
 * - Async mode (production): Uses Puppeteer to bypass Cloudflare
 */
export default function parse(dom, fn) {
  lastRequestTime = Date.now();

  const lifts = select(dom, '.lifts-row');

  if (lifts.length > 0) {
    debug('Parsing provided DOM with %d lifts', lifts.length);
    const liftStatus = domutil.collect(dom, '.lifts-row', parseConfig);
    debug('Whiteface Lift Status:', liftStatus);

    if (typeof fn === 'function') {
      return fn(null, liftStatus);
    }
    return liftStatus;
  }

  debug('No lift data in DOM');

  if (typeof fn !== 'function') {
    debug('No callback provided, returning cached result');
    return cachedStatus;
  }

  if (!shouldFetch()) {
    debug('Using cached lift status');
    return fn(null, cachedStatus);
  }

  debug('Fetching with Puppeteer (active=%s)', isUserActive());

  fetchWithPuppeteer()
    .then(html => {
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Next fetch in %d min', Math.round(nextFetchInterval / 60000));

      if (!html) {
        debug('No HTML returned, using cached');
        return fn(null, cachedStatus);
      }

      const fetchedDom = parseDocument(html);
      const liftStatus = domutil.collect(fetchedDom, '.lifts-row', parseConfig);
      cachedStatus = liftStatus;
      debug('Whiteface Lift Status (via Puppeteer):', liftStatus);
      fn(null, liftStatus);
    })
    .catch(err => {
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Puppeteer fetch exception:', err);
      fn(null, cachedStatus);
    });
}

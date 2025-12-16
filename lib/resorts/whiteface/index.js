import Debug from 'debug';
import { parseDocument } from 'htmlparser2';
import select from '../../select.js';
import * as domutil from '../../tools/domutil.js';

const debug = Debug('liftie:resort:whiteface');

const whitefaceUrl = 'https://whiteface.com/mountain/conditions/';

// Adaptive rate limiting based on activity
const ACTIVE_MIN_INTERVAL = 5 * 60 * 1000;
const ACTIVE_MAX_INTERVAL = 15 * 60 * 1000;
const INACTIVE_MIN_INTERVAL = 30 * 60 * 1000;
const INACTIVE_MAX_INTERVAL = 60 * 60 * 1000;
const ACTIVITY_THRESHOLD = 5 * 60 * 1000;

// Operating hours in NY timezone (EST/EDT)
const OPEN_HOUR = 7.75;
const CLOSE_HOUR = 17.5;

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
  return Date.now() - lastRequestTime < ACTIVITY_THRESHOLD;
}

function shouldFetch() {
  const now = Date.now();
  if (lastFetchTime === 0) return true;
  if (now - lastFetchTime < nextFetchInterval) {
    debug('Rate limited: %d min until next fetch', Math.round((nextFetchInterval - (now - lastFetchTime)) / 60000));
    return false;
  }
  if (!isWithinOperatingHours()) {
    debug('Outside operating hours, using cached data');
    return false;
  }
  return true;
}

/**
 * Custom parser that handles both old and new ORDA HTML structures.
 * Old (test HTML): .conditions-data-row.lifts-row with 4 children:
 *   [0]=type, [1]=name, [2]=status icon, [3]=time
 * New (live): .lifts-row with 2 children:
 *   [0]=name, [1]=status icon
 */
function parseLifts(dom) {
  const ls = {};
  const rows = select(dom, '.lifts-row');

  rows.forEach(row => {
    const children = row.children?.filter(c => c.type === 'tag') || [];
    let name = null;
    let status = null;

    // Try to detect structure by looking for specific classes
    for (const child of children) {
      const className = child.attribs?.class || '';

      // New structure: "column first title" contains name
      if (className.includes('title') || className.includes('lift-name')) {
        name = domutil.allText(child).trim();
      }

      // New structure: "column second status" or old: "lift-icon"
      if (className.includes('status') || className.includes('lift-icon')) {
        // Find the img inside
        const img = select(child, 'img')[0];
        if (img?.attribs?.src) {
          const match = img.attribs.src.match(/icon-(.+)\.svg/);
          if (match) {
            status = match[1];
          }
        }
      }
    }

    if (name && status) {
      debug('Found lift: %s = %s', name, status);
      ls[name] = status;
    }
  });

  return ls;
}

/**
 * Fetch page using Puppeteer to bypass Cloudflare JS challenge
 */
async function fetchWithPuppeteer() {
  let browser = null;
  try {
    const puppeteer = await import('puppeteer');
    debug('Launching Puppeteer browser');
    browser = await puppeteer.default.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    debug('Navigating to %s', whitefaceUrl);
    await page.goto(whitefaceUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    debug('Waiting for lift data');
    await page.waitForSelector('.lifts-row', { timeout: 30000 });
    const html = await page.content();
    await browser.close();
    debug('Got page content, length: %d', html.length);
    return html;
  } catch (err) {
    debug('Puppeteer error:', err.message);
    if (browser) await browser.close();
    return null;
  }
}

/**
 * Parser for Whiteface.
 * - If DOM has .lifts-row elements, parse and return immediately
 * - Otherwise, return a Promise that fetches via Puppeteer
 */
export default function parse(dom) {
  lastRequestTime = Date.now();

  const lifts = select(dom, '.lifts-row');

  // If we have lift data in the provided DOM, parse it directly
  if (lifts.length > 0) {
    debug('Parsing provided DOM with %d lifts', lifts.length);
    const liftStatus = parseLifts(dom);
    debug('Whiteface Lift Status:', liftStatus);
    return liftStatus;
  }

  debug('No lift data in DOM, need Puppeteer fetch');

  // Check rate limiting
  if (!shouldFetch()) {
    debug('Using cached lift status');
    return cachedStatus;
  }

  // Return a Promise - the framework will await it
  debug('Fetching with Puppeteer (active=%s)', isUserActive());
  return fetchWithPuppeteer()
    .then(html => {
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Next fetch in %d min', Math.round(nextFetchInterval / 60000));

      if (!html) {
        debug('No HTML returned, using cached');
        return cachedStatus;
      }

      const fetchedDom = parseDocument(html);
      const liftStatus = parseLifts(fetchedDom);
      cachedStatus = liftStatus;
      debug('Whiteface Lift Status (via Puppeteer):', liftStatus);
      return liftStatus;
    })
    .catch(err => {
      lastFetchTime = Date.now();
      nextFetchInterval = getRandomInterval(isUserActive());
      debug('Puppeteer fetch exception:', err);
      return cachedStatus;
    });
}

const { join } = require('node:path');

/*
 * Keep the downloaded browser inside the project rather than in $HOME.
 *
 * The app is started by root while the repo is maintained as webadmin, so a
 * HOME-relative cache would resolve to a different directory depending on who
 * ran the install, and the browser would appear missing at runtime.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer')
};

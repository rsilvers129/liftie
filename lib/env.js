import { tmpdir } from 'node:os';

const {
  CSP_REPORT_URI,
  LIFTIE_CSP_ENFORCE,
  LIFTIE_STATIC_HOST = '',
  // Several resorts reject requests that carry no User-Agent at all, so this
  // needs a default rather than being left undefined when the env var is unset
  LIFTIE_USER_AGENT = 'Mozilla/5.0 (compatible; Liftie/1.0; +https://liftie.info)',
  LOG_DIR = tmpdir(),
  NODE_ENV = 'development',
  OPENWEATHER_API_KEY,
  PORT = 3000,
  WEBCAMS_API_KEY
} = process.env;

process.env.SITE_URL ??= `http://localhost:${PORT}`;

const { SITE_URL } = process.env;

export {
  CSP_REPORT_URI,
  LIFTIE_CSP_ENFORCE,
  LIFTIE_STATIC_HOST,
  LIFTIE_USER_AGENT,
  LOG_DIR,
  NODE_ENV,
  OPENWEATHER_API_KEY,
  PORT,
  SITE_URL,
  WEBCAMS_API_KEY
};

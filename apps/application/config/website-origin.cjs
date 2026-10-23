const { validateApiOrigin } = require('./api-origin.cjs');

const PUBLIC_WEBSITE_ORIGIN = 'https://www.wings4ulondon.ca';

function validateWebsiteOrigin(value, production) {
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing origin');
    return validateApiOrigin(value.trim(), production);
  } catch {
    throw new Error('Mobile websiteUrl must be an HTTP(S) origin without credentials, path, query or fragment; production requires public HTTPS.');
  }
}

module.exports = { PUBLIC_WEBSITE_ORIGIN, validateWebsiteOrigin };

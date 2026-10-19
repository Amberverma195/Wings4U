/** Public build configuration only. No secrets or production defaults. */
function validateApiOrigin(value, production) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Mobile API origin must be an HTTP(S) origin without credentials or a path.');
  }
  if (production && (url.protocol !== 'https:' || !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':'))) {
    throw new Error('Production mobile builds require a public HTTPS API origin.');
  }
  return url.origin;
}
module.exports = { validateApiOrigin };

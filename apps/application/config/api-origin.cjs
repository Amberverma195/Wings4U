/** Public build configuration only. No secrets or production defaults. */
function validateApiOrigin(value, production) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Mobile API origin must be an HTTP(S) origin without credentials or a path.');
  }
  if (production && (url.protocol !== 'https:' || !host.includes('.') ||
    /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid)$/.test(host) ||
    /(^|\.)home\.arpa$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':'))) {
    throw new Error('Production mobile builds require a public HTTPS API origin.');
  }
  return url.origin;
}

/** Loopback, private-network, link-local, emulator and local-only hostnames. */
function isLocalDevelopmentOrigin(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return !host.includes('.') ||
    /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid)$/.test(host) ||
    /(^|\.)home\.arpa$/.test(host);
}

/**
 * Order events only reach a socket on the backend that handled the order, so
 * Socket.IO must reach the REST backend: the same origin, a declared alias of
 * it, or (development only) two local origins on the developer's machines.
 */
function realtimeTargetsApi(apiOrigin, realtimeOrigin, aliasOf, production) {
  return realtimeOrigin === apiOrigin || aliasOf === apiOrigin ||
    (!production && isLocalDevelopmentOrigin(apiOrigin) && isLocalDevelopmentOrigin(realtimeOrigin));
}

module.exports = { validateApiOrigin, isLocalDevelopmentOrigin, realtimeTargetsApi };

'use strict';

// ---------------------------------------------------------------------------
// Production database guard
//
// Blocks destructive operations (e2e test setup, prisma reset, seed) from
// running against the production database.  Four layers of defence:
//
//   1. Known project reference — catches the exact Supabase project that
//      hosts production.
//   2. Hosted-database hostname patterns — catches Supabase and Railway
//      URLs even if the project ref changes or is obfuscated.
//   3. Positive local-host verification — every URL must resolve to a
//      known-safe local hostname (localhost, 127.0.0.1, ::1, 0.0.0.0).
//      Remote databases on custom domains are refused even if they don't
//      match a known hosted pattern.
//   4. Fail-closed opt-in — destructive callers must set
//      DATABASE_ALLOW_DESTRUCTIVE=true *and* pass layers 1–3 to proceed.
//
// Non-destructive flows (local API dev, prisma generate, migrate deploy,
// production deployment) never call into the strict path and are unaffected.
// ---------------------------------------------------------------------------

// Supabase project that hosts the production database.
const PRODUCTION_PROJECT_REF = 'qdzwgollskyflllhdixs';

// Hostname patterns that indicate a hosted (non-local) database.
// Any URL matching one of these is treated as potentially production.
const HOSTED_DB_PATTERNS = [
  /\.supabase\.co\b/i,
  /\.supabase\.com\b/i,
  /\.supabase\.in\b/i,
  /supabase-pool/i,
  /\.railway\.internal\b/i,
  /\.railway\.app\b/i,
];

// Hostnames that are known-safe local targets.  Only URLs pointing at one
// of these are accepted by the strict destructive-operation guard.
const SAFE_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

/**
 * Return true when `url` contains the known production Supabase project
 * reference.  This is the most specific signal and catches any connection
 * URL format (pooled, direct, JDBC-style, URL-encoded).
 */
function containsProductionProjectRef(url) {
  if (typeof url !== 'string' || url === '') return false;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* fall back to raw */ }
  return [url, decoded].some((v) => v.toLowerCase().includes(PRODUCTION_PROJECT_REF));
}

/**
 * Return true when `url` points at a hosted database service rather than a
 * local Postgres instance.
 */
function isHostedDatabaseUrl(url) {
  if (typeof url !== 'string' || url === '') return false;
  try {
    const parsed = new URL(url);
    if (SAFE_LOCAL_HOSTS.has(parsed.hostname)) return false;
  } catch { /* not a parseable URL — fall through to pattern matching */ }
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* raw is fine */ }
  return [url, decoded].some((v) => HOSTED_DB_PATTERNS.some((p) => p.test(v)));
}

/**
 * Return true when the URL's hostname is a known-safe local address.
 * Returns false for non-parseable URLs, empty strings, or any remote host.
 */
function isLocalDatabaseUrl(url) {
  if (typeof url !== 'string' || url === '') return false;
  try {
    const parsed = new URL(url);
    return SAFE_LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Combined check: returns true when the URL matches the known production
 * project reference *or* points at a hosted database service.
 */
function looksLikeProductionUrl(url) {
  return containsProductionProjectRef(url) || isHostedDatabaseUrl(url);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lightweight guard — throws if any provided URL matches a production signal.
 *
 * Use this in code paths where you want to block a known-bad target but do
 * not need the full fail-closed handshake (e.g. prisma.config.ts gating
 * `migrate reset` / `db push --force-reset`).
 *
 * Never prints the actual URL to avoid leaking credentials in CI logs.
 */
function refuseProductionDatabase(purpose, urls) {
  const candidates = Array.isArray(urls)
    ? urls
    : [process.env.DATABASE_URL, process.env.DIRECT_URL];

  if (candidates.some(containsProductionProjectRef)) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose} against the production database. ` +
      'Point it at a dedicated, disposable database instead.',
    );
  }

  if (candidates.some(isHostedDatabaseUrl)) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose}: the database URL points at a ` +
      'hosted database service that could be production. Use a local or dedicated ' +
      'test database instead.',
    );
  }
}

/**
 * Strict, fail-closed guard for destructive operations (e2e setup, seed,
 * database reset).
 *
 * Requirements to pass (ALL must be met):
 *   1. At least one database URL must be provided.
 *   2. No URL may match the production project reference.
 *   3. No URL may point at a hosted database service.
 *   4. Every URL must resolve to a known-safe local hostname
 *      (localhost, 127.0.0.1, ::1, or 0.0.0.0).
 *   5. DATABASE_ALLOW_DESTRUCTIVE must be explicitly set to "true".
 *
 * If ANY check fails, the operation is refused.  This ensures destructive
 * commands can only ever target explicitly verified local disposable
 * databases, regardless of URL format or hosting provider.
 */
function requireSafeDestructiveTarget(purpose, urls) {
  const candidates = Array.isArray(urls)
    ? urls
    : [process.env.DATABASE_URL, process.env.DIRECT_URL];

  // 1. Fail closed: refuse if no URLs are configured at all.
  const definedUrls = candidates.filter((u) => typeof u === 'string' && u !== '');
  if (definedUrls.length === 0) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose}: no database URL is configured. ` +
      'Configure a dedicated local test database before running destructive operations.',
    );
  }

  // 2. Refuse if any URL contains the known production project reference.
  if (definedUrls.some(containsProductionProjectRef)) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose} against the production database. ` +
      'Point DATABASE_URL / DIRECT_URL at a dedicated, disposable local test database.',
    );
  }

  // 3. Refuse if any URL points at a hosted DB service.
  if (definedUrls.some(isHostedDatabaseUrl)) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose}: the database URL points at a ` +
      'hosted database service. Destructive operations require a local disposable ' +
      'test database.',
    );
  }

  // 4. Positive verification: every URL must target a known-safe local host.
  //    This catches remote databases on custom domains that don't match any
  //    hosted pattern above — only localhost/127.0.0.1/::1/0.0.0.0 pass.
  const nonLocalUrls = definedUrls.filter((u) => !isLocalDatabaseUrl(u));
  if (nonLocalUrls.length > 0) {
    throw new Error(
      `[production-guard] Refusing to run ${purpose}: one or more database URLs do not ` +
      'point at a local host. Destructive operations are only allowed against local ' +
      'databases (localhost, 127.0.0.1, ::1, or 0.0.0.0).',
    );
  }

  // 5. Fail closed: require explicit opt-in.
  if (process.env.DATABASE_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error(
      `[production-guard] Refusing to run ${purpose}: DATABASE_ALLOW_DESTRUCTIVE is not ` +
      '"true". Set DATABASE_ALLOW_DESTRUCTIVE=true in your test environment to confirm ' +
      'the target is a disposable local database.',
    );
  }
}

// Backward-compatible alias.
const isProductionDatabaseUrl = looksLikeProductionUrl;

module.exports = {
  isProductionDatabaseUrl,
  looksLikeProductionUrl,
  containsProductionProjectRef,
  isHostedDatabaseUrl,
  isLocalDatabaseUrl,
  refuseProductionDatabase,
  requireSafeDestructiveTarget,
};

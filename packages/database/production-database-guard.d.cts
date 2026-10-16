/** Return true if the URL contains the known production Supabase project reference. */
export declare function containsProductionProjectRef(url: string | undefined): boolean;

/** Return true if the URL points at a hosted database service (Supabase, Railway, etc.). */
export declare function isHostedDatabaseUrl(url: string | undefined): boolean;

/** Return true if the URL matches any production detection signal. */
export declare function looksLikeProductionUrl(url: string | undefined): boolean;

/** @deprecated Use {@link looksLikeProductionUrl} instead. */
export declare function isProductionDatabaseUrl(url: string | undefined): boolean;

/**
 * Lightweight guard — throws if any provided URL matches a production signal.
 * Does NOT require DATABASE_ALLOW_DESTRUCTIVE.
 */
export declare function refuseProductionDatabase(purpose: string, urls?: Array<string | undefined>): void;

/**
 * Strict, fail-closed guard for destructive operations.
 * Requires: valid URLs, no production signals, and DATABASE_ALLOW_DESTRUCTIVE=true.
 */
export declare function requireSafeDestructiveTarget(purpose: string, urls?: Array<string | undefined>): void;

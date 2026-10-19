/** Advertised pickup range. Kitchen lead times and live order ETAs are separate. */
export const PICKUP_ETA_MIN_MINUTES = 15;
export const PICKUP_ETA_MAX_MINUTES = 20;
export const PICKUP_ETA_RANGE = `${PICKUP_ETA_MIN_MINUTES}\u2013${PICKUP_ETA_MAX_MINUTES}`;
export const PICKUP_ETA_RANGE_ASCII = `${PICKUP_ETA_MIN_MINUTES}-${PICKUP_ETA_MAX_MINUTES}`;

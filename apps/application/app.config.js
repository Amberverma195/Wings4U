const { validateApiOrigin, isLocalDevelopmentOrigin } = require('./config/api-origin.cjs');

const REMOTE_DEVELOPMENT_OPT_IN = 'MOBILE_DEV_REMOTE_API';

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const release = (profile && profile !== 'development') || (!profile && process.env.NODE_ENV === 'production');
  if (release && process.env.MOBILE_APP_ENV === 'development') {
    throw new Error('MOBILE_APP_ENV=development conflicts with this release build. Production and preview builds require production API configuration.');
  }
  const environment = process.env.MOBILE_APP_ENV ||
    (profile ? (profile === 'development' ? 'development' : 'production') : process.env.NODE_ENV === 'production' ? 'production' : 'development');
  if (!['development', 'production'].includes(environment)) throw new Error('MOBILE_APP_ENV must be development or production.');
  const production = environment === 'production';
  const explicitApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN;
  const apiOrigin = explicitApiOrigin || (production ? '' : config.extra?.developmentApiOrigin);
  if (production && !apiOrigin) throw new Error('Set EXPO_PUBLIC_API_ORIGIN to the website\'s deployed NestJS API origin for production mobile builds.');
  const realtimeOrigin = process.env.EXPO_PUBLIC_REALTIME_ORIGIN;
  const validatedApiOrigin = apiOrigin ? validateApiOrigin(apiOrigin, production) : undefined;
  const validatedRealtimeOrigin = realtimeOrigin ? validateApiOrigin(realtimeOrigin, production) : undefined;
  if (!production) {
    // Development builds talk to a local API unless a remote backend (such as
    // the deployed API, which serves production data) is chosen deliberately.
    const remote = [explicitApiOrigin && validatedApiOrigin, validatedRealtimeOrigin]
      .filter(origin => origin && !isLocalDevelopmentOrigin(origin));
    if (remote.length && process.env[REMOTE_DEVELOPMENT_OPT_IN] !== 'allow') {
      throw new Error(`Development build targets remote backend ${[...new Set(remote)].join(', ')}. ` +
        `Set ${REMOTE_DEVELOPMENT_OPT_IN}=allow to confirm; remote APIs may serve production data.`);
    }
    // Order events are only emitted by the API process that handled the order.
    if (validatedRealtimeOrigin && !isLocalDevelopmentOrigin(validatedRealtimeOrigin) &&
      !(explicitApiOrigin && !isLocalDevelopmentOrigin(validatedApiOrigin))) {
      throw new Error('EXPO_PUBLIC_REALTIME_ORIGIN is remote but the REST API is local. Set EXPO_PUBLIC_API_ORIGIN to the same backend.');
    }
  }
  return { ...config, extra: { ...config.extra, environment,
    apiOrigin: validatedApiOrigin,
    apiOriginExplicit: Boolean(explicitApiOrigin),
    realtimeOrigin: validatedRealtimeOrigin,
    defaultLocationId: process.env.EXPO_PUBLIC_DEFAULT_LOCATION_ID || config.extra?.defaultLocationId,
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || config.extra?.stripePublishableKey,
  } };
};

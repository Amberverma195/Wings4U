const { validateApiOrigin } = require('./config/api-origin.cjs');

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const environment = process.env.MOBILE_APP_ENV ||
    (profile ? (profile === 'development' ? 'development' : 'production') : process.env.NODE_ENV === 'production' ? 'production' : 'development');
  if (!['development', 'production'].includes(environment)) throw new Error('MOBILE_APP_ENV must be development or production.');
  const production = environment === 'production';
  const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || (production ? '' : config.extra?.developmentApiOrigin);
  if (production && !apiOrigin) throw new Error('Set EXPO_PUBLIC_API_ORIGIN to the website\'s deployed NestJS API origin for production mobile builds.');
  const realtimeOrigin = process.env.EXPO_PUBLIC_REALTIME_ORIGIN;
  return { ...config, extra: { ...config.extra, environment,
    apiOrigin: apiOrigin ? validateApiOrigin(apiOrigin, production) : undefined,
    realtimeOrigin: realtimeOrigin ? validateApiOrigin(realtimeOrigin, production) : undefined,
    defaultLocationId: process.env.EXPO_PUBLIC_DEFAULT_LOCATION_ID || config.extra?.defaultLocationId,
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || config.extra?.stripePublishableKey,
  } };
};

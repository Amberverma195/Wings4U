/** No app startup, dotenv, Prisma CLI, or production access. Only mocks and tsc. */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'test', JWT_SECRET: 'terminal-orders-unit-test-secret',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/forbidden',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/forbidden',
  PGHOST: '127.0.0.1', PGPORT: '1', REDIS_URL: '', ONLINE_PAYMENTS_ENABLED: 'false',
  ACCOUNT_DELETION_ENABLED: 'false', ACCOUNT_DELETION_POLICY_VERSION: '',
  API_PROXY_TARGET: 'http://127.0.0.1:1', INTERNAL_API_URL: 'http://127.0.0.1:1' };
const jestBin = require.resolve('jest/bin/jest');
let failed = false;
const selected = process.argv[2];
if (selected && !['api', 'web', 'application', 'types'].includes(selected)) {
  throw new Error('Choose api, web, application, or types; omit to run all checks.');
}
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) failed = true;
}
for (const workspace of ['api', 'web', 'application']) {
  if (selected && selected !== workspace && selected !== 'types') continue;
  if (selected !== 'types') {
    const filename = workspace === 'api' ? 'jest-unit.json' : 'jest.config.cjs';
    const config = require(resolve(root, 'apps', workspace, filename));
    config.rootDir = resolve(root, 'apps', workspace, workspace === 'api' ? 'src' : '.');
    config.setupFiles = [resolve(__dirname, 'terminal-orders-test-setup.cjs')];
    if (workspace === 'api') config.transform = { '^.+\\.ts$': 'ts-jest' };
    config.testRegex = workspace === 'api'
      ? '(kds/(kds\\.service|kds-terminal)|orders/.*|admin/admin-terminal|auth/account-deletion\\.service|payments/.*|refunds/.*|chat/.*|realtime/realtime\\.gateway|rewards/rewards\\.service)\\.spec\\.ts$'
      : undefined;
    if (workspace !== 'api') config.testMatch = (workspace === 'web'
      ? ['terminal-orders', 'account-deletion', 'account-deletion-session', 'order-terminal-tracking', 'pickup-eta']
      : ['account-deletion', 'account-deletion-cleanup', 'order-detail-realtime', 'order-tracking-details', 'order-actions',
        'cancellation-eligibility', 'order-realtime', 'use-chat', 'payment-options', 'delivery-pin', 'account-orders-pagination'])
      .map(name => '<rootDir>/tests/' + name + '.test.cjs');
    run([jestBin, '--config', JSON.stringify(config), '--runInBand', '--silent']);
  }
  if (!selected || selected === 'types') {
    const tsc = workspace === 'application'
      ? require.resolve('typescript/lib/tsc.js', { paths: [resolve(root, 'apps/application')] })
      : require.resolve('typescript/lib/tsc.js');
    run([tsc, '--noEmit', '--incremental', 'false', '-p', 'apps/' + workspace + '/tsconfig.json']);
  }
}
process.exitCode = failed ? 1 : 0;

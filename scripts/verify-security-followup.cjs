/** Safe mocked checks only. Deliberately does not load .env or invoke e2e/build/migrations. */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'test', JWT_SECRET: 'security-followup-test-secret',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/forbidden',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/forbidden',
  PGHOST: '127.0.0.1', PGPORT: '1', REDIS_URL: '', API_PROXY_TARGET: 'http://127.0.0.1:1', INTERNAL_API_URL: 'http://127.0.0.1:1' };
const jest = require.resolve('jest/bin/jest');
const tsc = require.resolve('typescript/lib/tsc.js');
let failed = false;
for (const workspace of ['api', 'web', 'application']) {
  const config = workspace === 'api' ? 'jest-unit.json' : 'jest.config.cjs';
  const result = spawnSync(process.execPath, [jest, '--config', 'apps/' + workspace + '/' + config,
    '--runInBand', '--no-cache', '--silent'], { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) failed = true;
  const types = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'apps/' + workspace + '/tsconfig.json'],
    { cwd: root, env, stdio: 'inherit' });
  if (types.error || types.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

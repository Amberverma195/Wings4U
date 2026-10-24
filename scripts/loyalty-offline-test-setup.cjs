// Explicitly opt in with --setupFilesAfterEnv. No application bootstrap or .env loading.
const path = require('node:path');
const OFFLINE_DB = 'postgresql://offline:offline@127.0.0.1:1/wings4u_loyalty_unit_tests';
process.env.DATABASE_URL = OFFLINE_DB;
process.env.DIRECT_URL = OFFLINE_DB;
process.env.NODE_ENV = 'test';

jest.mock(path.resolve(__dirname, '../apps/api/src/database/prisma.service.ts'), () => ({
  PrismaService: class OfflinePrismaService {
    constructor() { throw new Error('Use a Prisma mock; database clients are forbidden in loyalty unit tests.'); }
  },
}));

const blocked = () => { throw new Error('External I/O and environment-file loading are forbidden in loyalty unit tests.'); };
jest.spyOn(process, 'loadEnvFile').mockImplementation(blocked);
jest.spyOn(require('dotenv'), 'config').mockImplementation(blocked);
const socketConnect = require('node:net').Socket.prototype.connect;
jest.spyOn(require('node:net').Socket.prototype, 'connect').mockImplementation(function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host : args[1];
  const port = typeof options === 'object' ? options.port : options;
  // Only in-process HTTP fixtures may connect. Port 1 (the dummy DB) is blocked too.
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || Number(port) === 1) return blocked();
  return socketConnect.apply(this, args);
});
global.fetch = blocked; // Individual HTTP/email tests install their own mocked fetch.

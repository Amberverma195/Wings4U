// Opt-in guard for isolated unit tests when the root .env targets production.
// Replace the module before its top-level loadEnvFile can execute.
jest.mock('../src/database/prisma.service', () => ({
  PrismaService: class {
    constructor() { throw new Error('Use a mocked repository in offline unit tests'); }
  },
}));

const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = args[0];
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('External network access is disabled in offline unit tests');
  }
  return connect.apply(this, args);
};
global.fetch = () => { throw new Error('Mock fetch in offline unit tests'); };

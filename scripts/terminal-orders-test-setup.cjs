// Mock-only verification: importing the real PrismaService or opening a socket
// must fail before any connection (including production) can be attempted.
const deny = () => { throw new Error('External I/O is forbidden in terminal-order unit tests'); };
process.loadEnvFile = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:net').Server.prototype.listen = deny;
require('node:tls').connect = deny;
require('node:dgram').Socket.prototype.send = deny;
global.fetch = deny;
jest.doMock(require.resolve('../apps/api/src/database/prisma.service.ts'), () => ({
  PrismaService: class { constructor() { throw new Error('Use a mocked PrismaService in unit tests'); } },
}));

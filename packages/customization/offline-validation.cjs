'use strict';
// Optional preload for build verification. Leaves all environment connections
// unchanged while refusing outbound sockets; local build-worker IPC still works.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  let host;
  if (first && typeof first === 'object') {
    if (first.path || first.fd !== undefined) return connect.apply(this, args);
    host = first.host ?? first.hostname;
  } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) host = typeof normalized[1] === 'string' ? normalized[1] : undefined;
  else if (typeof first === 'string') return connect.apply(this, args); // local named pipe
  if (host && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('Offline validation refused an outbound connection');
  }
  return connect.apply(this, args);
};

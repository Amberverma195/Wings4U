/**
 * Minimal stand-in for a socket.io-client Socket. It follows the client's
 * semantics that the order realtime controller depends on: `timeout().emit`
 * acknowledgements fail after the timeout, pending acknowledgements fail when
 * the connection drops, and a client `disconnect()` emits `io client disconnect`.
 */
function createFakeSocket() {
  const listeners = new Map();
  const acks = [];
  const fire = (event, ...args) => { for (const fn of [...(listeners.get(event) ?? [])]) fn(...args); };
  const settle = (entry, error, response) => {
    if (entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    entry.callback(error, response);
  };
  const dropAcks = () => { for (const entry of acks.splice(0)) settle(entry, new Error('socket has been disconnected')); };
  const socket = {
    connected: false,
    connect: jest.fn(),
    disconnect: jest.fn(() => {
      if (!socket.connected) return;
      socket.connected = false;
      fire('disconnect', 'io client disconnect');
      dropAcks();
    }),
    on: jest.fn((event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    }),
    off: jest.fn((event, fn) => { listeners.get(event)?.delete(fn); }),
    timeout: jest.fn(ms => ({
      emit: (event, data, callback) => {
        const entry = { event, channel: data.channel, callback, done: false };
        entry.timer = setTimeout(() => settle(entry, new Error('operation has timed out')), ms);
        acks.push(entry);
      },
    })),
  };
  return {
    socket,
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    pendingChannels: () => acks.filter(entry => !entry.done).map(entry => entry.channel),
    serverConnect() { socket.connected = true; fire('connect'); },
    serverDisconnect(reason) { socket.connected = false; fire('disconnect', reason); dropAcks(); },
    connectError() { fire('connect_error', new Error('websocket error')); },
    emitEvent(event, payload = {}) { fire(event, { event_type: event, payload, timestamp: new Date().toISOString() }); },
    ack(channel, response) {
      const entry = acks.find(candidate => !candidate.done && candidate.channel === channel);
      if (!entry) throw new Error(`No pending subscribe for ${channel}`);
      settle(entry, null, response ?? { subscribed: true, channel });
    },
    ackAll() { for (const entry of acks.filter(candidate => !candidate.done)) settle(entry, null, { subscribed: true, channel: entry.channel }); },
  };
}

module.exports = { createFakeSocket };

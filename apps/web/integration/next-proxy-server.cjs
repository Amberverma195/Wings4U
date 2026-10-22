// Child process: an isolated Next project with the repository's real config and route sources.
const http = require('node:http');
const next = require('next');
const app = next({ dev: process.argv[3] !== 'production', dir: process.argv[2], hostname: '127.0.0.1', port: 0 });
let server;
app.prepare().then(() => {
  server = http.createServer(app.getRequestHandler());
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
}).catch(error => { process.send({ error: error.message }); process.exit(1); });
process.on('message', async message => {
  if (message === 'stop') { server?.closeAllConnections(); server?.close(); await app.close(); process.exit(0); }
});

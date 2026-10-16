'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routes = new Map([
  ['/sdk/', ['sdk/index.html', 'text/html; charset=utf-8']],
  ['/sdk/index.html', ['sdk/index.html', 'text/html; charset=utf-8']],
  ['/sdk/host.js', ['sdk/host.js', 'text/javascript; charset=utf-8']],
  ['/sdk/styles.css', ['sdk/styles.css', 'text/css; charset=utf-8']],
  ['/sdk/starter.manifest.json', ['sdk/starter.manifest.json', 'application/json; charset=utf-8']],
  ['/sdk/water.manifest.json', ['sdk/water.manifest.json', 'application/json; charset=utf-8']],
  ['/module-runtime.js', ['module-runtime.js', 'text/javascript; charset=utf-8']],
  ['/docs/MODULES.md', ['docs/MODULES.md', 'text/plain; charset=utf-8']],
  ['/docs/module-manifest.schema.json', ['docs/module-manifest.schema.json', 'application/json; charset=utf-8']],
]);

function handleRequest(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end('Method not allowed'); return; }
    let pathname;
    try { pathname = new URL(request.url, 'http://127.0.0.1').pathname; }
    catch (_) { response.writeHead(400); response.end('Bad request'); return; }
    if (pathname === '/') { response.writeHead(302, { Location: '/sdk/' }); response.end(); return; }
    const route = routes.get(pathname);
    if (!route) { response.writeHead(404); response.end('Not found'); return; }
    fs.readFile(path.join(root, route[0]), (error, content) => {
      if (error) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': route[1], 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    });
}
function createServer() { return http.createServer(handleRequest); }

if (require.main === module) {
  const port = process.argv[2] === undefined ? 55607 : Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('Choose a port from 1024 to 65535.'); process.exitCode = 1; }
  else {
    const server = createServer();
    server.on('error', error => { console.error('Module Lab could not start: ' + error.code); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log('Notchy Module Lab: http://127.0.0.1:' + port + '/sdk/'));
  }
}
module.exports = { createServer, handleRequest };

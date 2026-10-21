'use strict';

const http = require('node:http');
const https = require('node:https');
const { readFileSync } = require('node:fs');
const { pipeline } = require('node:stream');

const homepage = readFileSync(`${__dirname}/index.html`);
const hopByHop = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function cleanHeaders(headers) {
  const blocked = new Set(hopByHop);
  for (const name of String(headers.connection || '').split(',')) {
    blocked.add(name.trim().toLowerCase());
  }
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name)));
}

function parseTarget(value) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('目标地址必须是 HTTP/HTTPS URL，且不能包含用户名或密码');
  }
  return target;
}

function corsHeaders(req) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
    'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition, ETag, Last-Modified',
  };
}

function createServer({ timeoutMs = 60_000, maxRedirects = 10 } = {}) {
  return http.createServer((req, res) => {
    const cors = corsHeaders(req);
    function fail(status, message) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { ...cors, 'content-type': 'text/plain; charset=utf-8' });
      res.end(message);
    }

    if (req.url === '/' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': homepage.length });
      return res.end(req.method === 'HEAD' ? undefined : homepage);
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    let target;
    try {
      target = parseTarget(req.url.slice(1));
    } catch {
      return fail(400, '目标 URL 无效，请使用 /https://example.com/file.zip');
    }
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.writeHead(204, { ...cors, 'access-control-max-age': '600' });
      return res.end();
    }

    const headers = cleanHeaders(req.headers);
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    // Expect is handled by this server; do not ask the upstream to repeat the handshake.
    delete headers.expect;
    let upstreamRequest;
    let upstreamResponse;
    let stopped = false;
    const stop = () => {
      stopped = true;
      upstreamRequest?.destroy();
      upstreamResponse?.destroy();
    };
    req.on('aborted', stop);
    req.on('error', stop);
    res.on('close', stop);
    res.on('error', stop);

    function forward(url, redirects) {
      if (stopped) return;
      const transport = url.protocol === 'https:' ? https : http;
      upstreamRequest = transport.request(url, { method: req.method, headers }, (response) => {
        upstreamResponse = response;
        const location = response.headers.location;
        const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode) && location;
        if (isRedirect && ['GET', 'HEAD'].includes(req.method)) {
          if (redirects >= maxRedirects) {
            response.destroy();
            return fail(502, '上游重定向次数过多');
          }
          let next;
          try {
            next = parseTarget(new URL(location, url).href);
          } catch {
            response.destroy();
            return fail(502, '上游重定向地址无效');
          }
          if (next.origin !== url.origin) {
            delete headers.authorization;
            delete headers.cookie;
          }
          response.destroy();
          return forward(next, redirects + 1);
        }

        const responseHeaders = cleanHeaders(response.headers);
        if (isRedirect) {
          // Streamed uploads cannot be replayed. Let the client follow the proxy URL.
          try {
            responseHeaders.location = `/${parseTarget(new URL(location, url).href).href}`;
          } catch {
            response.destroy();
            return fail(502, '上游重定向地址无效');
          }
        }
        res.writeHead(response.statusCode, { ...responseHeaders, ...cors });
        // Native HTTP preserves compressed bytes and Content-Length exactly.
        pipeline(response, res, (error) => {
          if (error) stop();
        });
      });
      upstreamRequest.setTimeout(timeoutMs, () => {
        fail(504, '上游连接超时');
        stop();
      });
      upstreamRequest.on('error', () => {
        if (!stopped) fail(502, '无法连接上游服务器');
      });
      if (redirects === 0 && !['GET', 'HEAD'].includes(req.method)) {
        // pipe applies backpressure while keeping upstream errors available for a 502 response.
        req.pipe(upstreamRequest);
      } else {
        upstreamRequest.end();
      }
    }
    forward(target, 0);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8020);
  const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 60_000);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    console.error('PORT 必须为 1–65535，UPSTREAM_TIMEOUT_MS 必须为正整数');
    process.exit(1);
  }
  const server = createServer({ timeoutMs });
  server.listen(port, () => console.log(`代理服务器运行在 http://localhost:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => {
        server.closeAllConnections();
        process.exit(0);
      }, 10_000).unref();
    });
  }
}

module.exports = { createServer };

// 保持 Service Worker 入口，可直接粘贴到现有 Cloudflare Worker。
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const MAX_REDIRECTS = 10;
// 只限制等待上游响应头的时间，不限制流式下载的总时长。
const UPSTREAM_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HOP_BY_HOP = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
];
const EXPOSE_HEADERS = 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition, ETag, Last-Modified';
const HOMEPAGE = `
    <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>空午HTTP代理下载</title>
    <link rel="icon" href="data:,"> <!-- 防止浏览器请求 /favicon.ico -->
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f5f5f5;
        color: #333;
      }
      h1 {
        color: #2c3e50;
        border-bottom: 2px solid #3498db;
        padding-bottom: 10px;
      }
      .container {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 0 20px rgba(0,0,0,0.1);
      }
      code {
        background: #f8f9fa;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
      }
      .example {
        background: #e8f4fc;
        padding: 15px;
        border-left: 4px solid #3498db;
        margin: 20px 0;
        border-radius: 0 4px 4px 0;
      }
      .note {
        background: #fff8e6;
        padding: 15px;
        border-left: 4px solid #ffc107;
        margin: 20px 0;
        border-radius: 0 4px 4px 0;
      }
      .features {
        margin: 25px 0;
      }
      .features li {
        margin-bottom: 10px;
      }
      a {
        color: #3498db;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>代理下载服务</h1>
      
      <p>由空午搭建的HTTP代理服务器，可用于绕过CORS限制或作为网络请求中转站。</p>
      
      <div class="features">
        <h2>功能特点：</h2>
        <ul>
          <li>支持所有HTTP方法（GET、POST、PUT、DELETE等）</li>
          <li>自动移除Origin和Referer请求头</li>
          <li>自动设置目标 Host，支持 Range 断点续传</li>
          <li>下载请求自动跟随重定向，跨域时移除凭据</li>
          <li>流式传输响应内容，支持大文件</li>
          <li>设置跨域头（Access-Control-Allow-Origin: *）</li>
        </ul>
      </div>
      
      <h2>使用方法：</h2>
      <div class="example">
        <p>在代理URL后直接添加目标URL：</p>
        <code>https://download.kuugo.cn/https://目标网站地址</code>
        
        <p>示例：</p>
        <code>https://download.kuugo.cn/https://example.com/download.zip</code>
      </div>
      
      <div class="note">
        <h3>注意事项：</h3>
        <ul>
          <li>目标URL需要完整包含协议（http:// 或 https://）</li>
          <li>支持转发认证请求头，但不管理网站登录会话</li>
          <li>上传和下载均采用流式传输，实际限制取决于 Cloudflare 套餐</li>
        </ul>
      </div>
    </div>
  </body>
  </html>
    `;

function cleanHeaders(source) {
  const headers = new Headers(source);
  const connectionHeaders = (headers.get('connection') || '').split(',');
  for (const name of connectionHeaders) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
}

function applyCors(headers) {
  // 不混用上游的凭据 CORS 策略和本代理的公共访问策略。
  for (const name of [
    'access-control-allow-credentials', 'access-control-allow-methods',
    'access-control-allow-headers', 'access-control-max-age',
  ]) headers.delete(name);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', EXPOSE_HEADERS);
  return headers;
}

function fail(status, message) {
  const headers = applyCors(new Headers({
    'content-type': 'text/plain; charset=UTF-8',
    'cache-control': 'no-store',
  }));
  return new Response(message, { status, headers });
}

function parseTarget(value, proxyOrigin) {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Invalid target URL');
  }
  // 防止直接请求自身，造成递归代理。
  if (target.origin === proxyOrigin) throw new Error('Recursive proxy URL');
  return target;
}

async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
    return new Response(request.method === 'HEAD' ? null : HOMEPAGE, {
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  }
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });

  let target;
  try {
    // 不解码整个路径，避免破坏签名 URL 中的 %2F、%26 等转义字符。
    target = parseTarget(url.pathname.slice(1) + url.search, url.origin);
  } catch {
    return fail(400, '目标 URL 无效，请使用 /https://example.com/file.zip');
  }

  if (request.method === 'OPTIONS' && request.headers.has('access-control-request-method')) {
    const headers = applyCors(new Headers());
    headers.set('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('access-control-allow-headers', request.headers.get('access-control-request-headers') || '*');
    headers.set('access-control-max-age', '600');
    headers.set('vary', 'Access-Control-Request-Headers');
    return new Response(null, { status: 204, headers });
  }

  const headers = cleanHeaders(request.headers);
  for (const name of ['host', 'origin', 'referer', 'expect']) headers.delete(name);
  const canFollow = ['GET', 'HEAD'].includes(request.method);

  for (let redirects = 0; ; redirects++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(target.href, {
        method: request.method,
        headers,
        body: canFollow ? undefined : request.body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      return fail(timedOut ? 504 : 502, timedOut ? '上游响应超时' : '无法连接上游服务器');
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
    }

    const location = response.headers.get('location');
    const isRedirect = REDIRECT_STATUSES.has(response.status) && location;
    let next;
    if (isRedirect) {
      try {
        next = parseTarget(new URL(location, target).href, url.origin);
      } catch {
        await response.body?.cancel();
        return fail(502, '上游重定向地址无效');
      }
      if (canFollow) {
        // 释放中间响应流，避免占用 Workers 的并发连接额度。
        await response.body?.cancel();
        if (redirects >= MAX_REDIRECTS) return fail(502, '上游重定向次数过多');
        if (next.origin !== target.origin) {
          headers.delete('authorization');
          headers.delete('cookie');
        }
        target = next;
        continue;
      }
    }

    const responseHeaders = applyCors(cleanHeaders(response.headers));
    // 上传流不能重放，由客户端通过代理地址继续处理重定向。
    if (isRedirect) responseHeaders.set('location', `/${next.href}`);
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      // 原样传递上游压缩字节，防止 Workers 再次压缩。
      encodeBody: 'manual',
    });
  }
}

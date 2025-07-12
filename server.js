const express = require('express');
const { Readable } = require('stream');
const app = express();
const PORT = process.env.PORT || 8020;

// 特殊规则配置
const specialCases = [
  {
    pattern: /.*/, // 匹配所有域名
    rules: {
      "origin": "DELETE",
      "referer": "DELETE",
      "host": "KEEP", // 保留 Host 头
      // 可添加更多规则
    }
  }
];

// 处理请求头修改
function modifyHeaders(headers, hostname) {
  const newHeaders = { ...headers };
  
  for (const { pattern, rules } of specialCases) {
    if (pattern.test(hostname)) {
      for (const [header, action] of Object.entries(rules)) {
        const lowerHeader = header.toLowerCase();
        
        if (action === "DELETE") {
          delete newHeaders[lowerHeader];
        } else if (action !== "KEEP") {
          newHeaders[lowerHeader] = action;
        }
      }
      break;
    }
  }
  
  // 确保 Host 头正确
  if (!newHeaders.host) {
    newHeaders.host = hostname;
  }
  
  return newHeaders;
}

// 流式传输响应体
async function streamResponse(response, res) {
  // 复制响应头
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'content-encoding') {
      res.setHeader(key, value);
    }
  }
  
  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // 流式传输
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// 添加根路径说明页面
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
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
          <li>保留Host请求头确保正常访问</li>
          <li>自动处理重定向（301/302）</li>
          <li>流式传输响应内容，支持大文件</li>
          <li>设置跨域头（Access-Control-Allow-Origin: *）</li>
        </ul>
      </div>
      
      <h2>使用方法：</h2>
      <div class="example">
        <p>在代理URL后直接添加目标URL：</p>
        <code>https://download.kuugo.top/https://目标网站地址</code>
        
        <p>示例：</p>
        <code>https://download.kuugo.top/https://example.com/download.zip</code>
      </div>
      
      <div class="note">
        <h3>注意事项：</h3>
        <ul>
          <li>目标URL需要完整包含协议（http:// 或 https://）</li>
          <li>不支持需要身份验证的网站</li>
          <li>性能有限，不建议传输超大文件</li>
        </ul>
      </div>
    </div>
  </body>
  </html>
  `);
});

// 处理 favicon.ico 请求 - 防止无效URL错误
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // 返回无内容状态
});

// 处理代理请求
app.all('/*splat', async (req, res) => {
  try {
    // 从路径中提取目标 URL
    const targetUrl = req.originalUrl.slice(1);

    // 解析目标 URL
    const { hostname, protocol, pathname, search, hash } = new URL(targetUrl);
    const fullUrl = `${protocol}//${hostname}${pathname}${search}${hash}`;
    
    // 准备请求头
    const headers = modifyHeaders(req.headers, hostname);
    
    // 准备请求选项
    const options = {
      method: req.method,
      headers: headers,
      redirect: 'follow'
    };
    
    // 处理请求体 (非 GET/HEAD 请求)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      options.body = Buffer.concat(chunks);
    }
    
    // 使用 Node.js 18+ 内置 fetch
    const response = await fetch(fullUrl, options);
    
    // 处理重定向
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      return res.redirect(response.status, `/${location}`);
    }
    
    // 流式传输响应
    await streamResponse(response, res);
    
  } catch (error) {
    console.error('代理错误:', error);
    res.status(500).send(`代理错误: ${error.message}`);
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
  console.log(`使用示例: http://localhost:${PORT}/https://example.com/test.zip`);
});
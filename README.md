# HTTP 代理下载服务

这是一个基于 Node.js 的 HTTP 代理服务器，专为文件下载和跨域请求设计。它支持流式传输、自动处理请求头修改和跨域问题。

## 功能特性

- 🚀 支持所有 HTTP 方法（GET/POST/PUT/DELETE 等）
- 🛡️ 自动移除 Origin 和 Referer 请求头
- 🌐 保留 Host 请求头确保正常访问
- 🔁 自动处理重定向（301/302）
- ⚡ 流式传输响应内容，支持大文件下载
- 🔓 设置跨域头（Access-Control-Allow-Origin: *）
- 📦 Docker 容器化支持

## 快速开始

### 使用 Node.js 运行

```bash
# 初始化项目
npm init -y

# 安装依赖
npm install express

# 启动服务（默认端口 8020）
node server.js
```

### 使用 Docker 运行

```bash
# 构建 Docker 镜像
docker build -t download-server .

# 运行容器（映射主机端口 8000 到容器端口 8020）
docker run -p 8020:8020 -d download-server

# 从dockerhub拉取镜像
docker run -p 8000:80 -d kuugo/download-server:0.1
```

## 使用示例

在代理 URL 后直接添加目标 URL：

```
http://your-server:port/https://目标网站地址
```

### 示例请求

下载文件：
```
http://your-server:port/https://example.com/test.zip
```

访问网页资源：
```
http://your-server:port/https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css
```

### 示例代码（JavaScript Fetch）

```javascript
const proxyUrl = 'http://localhost:8020/';
const targetUrl = 'https://example.com/file.zip';

fetch(proxyUrl + targetUrl)
  .then(response => {
    // 处理响应
    const reader = response.body.getReader();
    // ...流式处理内容
  });
```

## 配置文件说明

在 `specialCases` 数组中配置请求头处理规则：

```javascript
const specialCases = [
  {
    pattern: /.*/, // 匹配所有域名
    rules: {
      "origin": "DELETE",    // 删除 Origin 头
      "referer": "DELETE",   // 删除 Referer 头
      "host": "KEEP",        // 保留 Host 头
      // 可添加更多规则...
    }
  }
];
```

## 根路径说明

访问根路径可查看服务说明文档：
```
http://localhost:8020/
```

## 注意事项

1. 目标 URL 需要完整包含协议（`http://` 或 `https://`）
2. 不支持需要身份验证的网站
3. 默认端口为 8020，可通过环境变量 `PORT` 修改

## 技术栈

- Node.js 18+（使用内置 fetch API）
- Express.js
- Docker
- 流式传输处理（Stream API）

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

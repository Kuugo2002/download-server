# HTTP 代理下载服务

**简体中文** | [English](README.en.md)

基于 Node.js 原生 HTTP 模块的流式代理，用于文件下载和跨域请求。无需安装第三方依赖。

## 功能

- 支持 GET、HEAD、POST、PUT、PATCH、DELETE 和 OPTIONS。
- 上传和下载均以流传输，自动根据接收速度控制读取，避免将整个文件载入内存。
- 保留上游状态码，包括 206、304、404，以及 Range、Content-Range、ETag 等下载和缓存头。
- 保留压缩响应的原始字节、Content-Encoding 和 Content-Length。
- 自动设置目标 Host（包含端口），移除 Origin、Referer 和逐跳头。
- GET/HEAD 自动跟随相对或绝对重定向，最多 10 次；跨源重定向移除 Authorization 和 Cookie。
- 上传请求的重定向返回代理地址，由客户端继续处理，避免缓存和重放上传数据。
- 支持浏览器 CORS 预检，并向浏览器开放常用下载响应头。
- 客户端断开后取消上游传输，上游连接空闲超时返回 504。

## 运行

需要 Node.js 22 或更高版本：

```bash
npm start
```

默认监听 8020 端口，访问 `http://localhost:8020/` 查看使用说明。

```bash
PORT=9000 UPSTREAM_TIMEOUT_MS=120000 npm start
```

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `PORT` | `8020` | 服务端口 |
| `UPSTREAM_TIMEOUT_MS` | `60000` | 上游套接字空闲超时（毫秒），持续传输的下载不会因总时长而超时 |

收到 SIGTERM/SIGINT 时停止接收新连接，最多等待 10 秒后退出。

## 使用

在代理地址后直接添加完整的 HTTP/HTTPS 目标 URL，保留目标端口和查询参数：

```text
http://localhost:8020/https://example.com/file.zip
http://localhost:8020/http://example.com:8080/file.zip?version=2
```

下载文件：

```bash
curl -L 'http://localhost:8020/https://example.com/file.zip' -o file.zip
```

断点续传（需要上游支持 Range）：

```bash
curl -L -C - 'http://localhost:8020/https://example.com/file.zip' -o file.zip
```

浏览器请求：

```javascript
const response = await fetch('http://localhost:8020/https://example.com/file.zip');
if (!response.ok) throw new Error(`下载失败：${response.status}`);
// 使用 response.body 继续按流读取文件。
```

普通 Authorization/Cookie 请求头可以转发，但本服务不管理目标站点的登录会话，也不重写网页内部链接或 Cookie 域。目标 URL 不能包含用户名或密码。

本服务允许请求任意 HTTP/HTTPS 地址，包括服务器可访问的内网地址，且默认开放 CORS。对外部署时应在网关限制访问者或目标地址。

## PM2 部署

适用于安装了 Node.js 22 或更高版本的 Linux 服务器。以下命令使用同一个部署用户执行，并在项目目录中启动服务。

### 安装并启动

```bash
npm install -g pm2

# 在项目目录中执行；端口和超时可按需调整
NODE_ENV=production PORT=8020 UPSTREAM_TIMEOUT_MS=60000 pm2 start server.js --name download-server --kill-timeout 11000 --time

# 查看进程状态并确认服务可访问
pm2 status
curl -I http://localhost:8020/
```

PM2 会在进程异常退出后自动重启。`--kill-timeout 11000` 为服务预留 11 秒退出时间，与服务自身最多 10 秒的连接收尾时间配合。

### 开机自启

```bash
pm2 startup
```

按终端提示执行生成的 `sudo` 命令，完成系统启动服务的安装，然后保存当前进程列表：

```bash
pm2 save
```

升级 Node.js 或改变其安装路径后，需要重新执行 `pm2 unstartup` 和 `pm2 startup`，按提示更新启动服务，再执行 `pm2 save`。

### 日常管理与更新

```bash
# 查看最近 100 行日志并持续跟踪（Ctrl+C 退出日志查看）
pm2 logs download-server --lines 100

# 更新项目代码后重启服务
pm2 restart download-server

# 修改环境变量并重启；保存后开机恢复时也会使用新配置
PORT=9000 UPSTREAM_TIMEOUT_MS=120000 pm2 restart download-server --update-env
pm2 save

# 停止服务
pm2 stop download-server

# 移除服务，并更新开机恢复的进程列表
pm2 delete download-server
pm2 save --force
```

单实例重启会中断正在进行的下载，建议选择空闲时段更新。

参考：[PM2 快速开始](https://doc.pm2.io/en/runtime/quick-start/)、[开机自启](https://pm2.io/docs/runtime/guide/startup-hook/)、[环境变量更新](https://pm2.io/docs/runtime/best-practices/environment-variables/)。

## Docker

```bash
docker build -t download-server .
docker run --rm -p 8020:8020 -e UPSTREAM_TIMEOUT_MS=60000 download-server
```

镜像以非 root 用户运行，不在构建时下载依赖。

## 验证

```bash
npm test
```

测试使用本地上游服务，覆盖状态码、端口和查询参数、压缩下载、Range、HEAD、空响应、流式上传、重定向、凭据清理、CORS、无效 URL、连接失败、超时和客户端取消。

## 许可证

[MIT](LICENSE)

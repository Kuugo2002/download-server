# Cloudflare Worker 下载代理

将 `worker.js` 部署到现有 Cloudflare Worker，继续使用 Service Worker 入口，无需安装运行时依赖。

在代理地址后拼接完整目标 URL，例如：

```text
https://download.kuugo.cn/https://example.com/file.zip?version=2
```

- 上传、下载均直接透传响应流，保留 Range、206、缓存头和压缩响应。
- 自动设置目标 Host，移除 Origin、Referer 和逐跳请求头。
- 浏览器预检在本地处理，向浏览器开放常用下载响应头；错误响应同样包含跨域头。
- GET/HEAD 最多跟随 10 次重定向，跨源时移除 Authorization 和 Cookie。
- 上传请求不重放请求体；重定向地址改写为代理路径，交由客户端处理。
- 仅接受 HTTP/HTTPS 地址，拒绝包含用户名、密码或指向当前代理源的目标。
- 等待每次上游响应头的超时为 30 秒，可修改 `UPSTREAM_TIMEOUT_MS`；收到响应头后立即清除计时器，不限制下载总时长。连接失败返回 502，超时返回 504。

主页保留原有使用说明。服务不管理目标网站登录会话，不重写网页内部链接，也不改写 Cookie 域。默认开放 CORS，公开部署时可在 Cloudflare 配置访问控制。

在项目根目录运行 `npm test`。测试使用 Node.js 内置 Fetch API 和模拟上游，验证代理逻辑；Cloudflare 专属的压缩行为、平台限制和线上连通性仍需在部署环境验证。

实现参考：[Workers Request](https://developers.cloudflare.com/workers/runtime-apis/request/)、[Workers Response](https://developers.cloudflare.com/workers/runtime-apis/response/)。

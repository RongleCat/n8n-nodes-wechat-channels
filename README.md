# n8n-nodes-wechat-channels

n8n 社区节点：下载并解密**微信视频号**加密视频，输出明文 MP4 二进制文件。

基于 Node.js 原生加载 WebAssembly 生成密钥流并完成 XOR 解密，无需无头浏览器。

## 节点：WeChat Channels Decrypt

### 功能

`加密视频直链 + 解密密钥` → 下载 → WASM 解密 → ftyp 校验 → 输出明文 MP4（binary）

### ⚠️ 职责边界

本节点**不请求视频号详情接口**，也不处理任何鉴权 token 与分享链接解析。它只接收上游已经获取到的**解密必需参数**，专注于「下载 + 解密 + 输出二进制」这一步。

请先用其他方式（例如 TikHub `fetch_video_detail` 等详情接口，或自行抓包）取得以下两个参数，再喂给本节点：

| 参数 | 必填 | 来源 |
| --- | --- | --- |
| `mediaUrl` | 是 | 详情接口 `objectDesc.media[0].url + urlToken`（配套鉴权直链） |
| `decodeKey` | 是 | 详情接口 `objectDesc.media[0].decodeKey` |

### 输入参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| 加密视频直链 (`mediaUrl`) | string | 是 | — | 视频号加密视频下载直链，需含 `urlToken` 鉴权 |
| 解密密钥 (`decodeKey`) | string | 是 | — | WASM 生成密钥流的种子 |
| 输出文件名 (`outputFileName`) | string | 否 | `video.mp4` | 输出二进制文件命名，建议 `.mp4` |
| 下载超时 (`downloadTimeout`) | number | 否 | `300` | 下载超时（秒） |

> 节点会对每个输入 item 执行（支持批量）。解密失败（如 `decodeKey` 不匹配导致 ftyp 校验不过）会抛出错误；开启节点的 *Continue On Fail* 时会输出 `success:false` 的错误项。

### 输出

- `binary.data`：解密后的明文 MP4（`video/mp4`）
- `json`：`{ success, fileName, encryptedSize, decryptedSize, mediaUrl }`

## Installation

按 n8n [社区节点安装指南](https://docs.n8n.io/integrations/community-nodes/installation/) 安装，或自托管环境在自定义节点目录：

```bash
npm install n8n-nodes-wechat-channels
```

重启 n8n 后在节点面板搜索「WeChat Channels Decrypt」。

## Compatibility

- n8n 推荐最新稳定版
- Node.js >= 18（依赖原生 `fetch`、`stream/promises`、`node:vm`）

## 解密原理

视频号仅加密文件的**前 128KB**，其余为明文：

1. 通过 `vm.runInNewContext` 加载官方 Emscripten glue（`wasm_video_decode.js`），注入 `Module.wasmBinary` 后门绕过网络加载，并**故意不注入 `fetch`** 以强制同步加载路径；
2. `new Module.WxIsaac64(decodeKey).generate(131072)` 生成 128KB 密钥流，并 **reverse 字节序**；
3. 对加密视频前 128KB 执行 **XOR**，明文部分原样保留；
4. 校验 `bytes[4:8] === 'ftyp'`，确认解密成功。

零运行时 npm 依赖（仅 Node 内置 `vm`/`fs`/`stream`/`fetch`）。

## Usage

典型工作流：上游节点（HTTP Request / 自定义详情节点）取得 `mediaUrl` 与 `decodeKey` → 本节点解密 → 下游 *Write Binary File* 或对象存储节点保存 MP4。

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Programmatic-style node tutorial](https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/)

## Development

```bash
npm install
npm run build      # 编译到 dist/
npm run lint       # 代码检查
npm run dev        # 本地链接到 n8n 实例热更新
```

## License

MIT

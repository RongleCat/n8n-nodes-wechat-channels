# wechat-channels-decrypt-node

- **创建**: 2026-06-25 23:46:49 CST
- **目标**: 将 wechat-channels-node-decrypt 的 node+wasm 解密能力封装为 n8n 社区节点
- **方案**: 方案 A — Programmatic TS 节点 + 核心逻辑迁移为 TS + wasm 作为静态资源

## 职责边界

- ❌ 不含：TikHub 详情接口请求、token、share_url 解析
- ✅ 仅做：接收 mediaUrl + decodeKey → 下载加密视频 → WASM 解密 → ftyp 校验 → 返回 MP4 二进制

## 入参

- `mediaUrl`（必填）：加密视频直链
- `decodeKey`（必填）：WASM 生成密钥流种子
- `outputFileName`（可选，默认 `video.mp4`）

## 文件结构

```
n8n-nodes-wechat-channels/
├── wechat-channels-node-decrypt/       ← 保留，参考源
├── package.json
├── tsconfig.json
├── gulpfile.js
├── README.md
├── src/wechatChannelsDecrypt/
│   ├── decrypt.ts                      ← XOR（迁移自 wasm/decrypt.js）
│   └── wasmDecrypt.ts                  ← vm+WASM（迁移自 lib/wasm-decrypt.js）
├── nodes/WeChatChannelsDecrypt/
│   ├── WeChatChannelsDecrypt.node.ts
│   ├── wechatChannelsDecrypt.svg
│   └── wasm/{wasm_video_decode.js, wasm_video_decode.wasm}
└── dist/
```

## 步骤

- [ ] Step 0-1 官方脚手架 `npm create @n8n/node` 落地当前目录
- [ ] Step 2 package.json 社区规范
- [ ] Step 3 拷贝 wasm 静态资源
- [ ] Step 4 迁移 decrypt.ts
- [ ] Step 5 迁移 wasmDecrypt.ts
- [ ] Step 6 实现 WeChatChannelsDecrypt.node.ts
- [ ] Step 7-8 gulpfile + tsconfig
- [ ] Step 9 图标 + README
- [ ] Step 10-11 install + build + lint
- [ ] Step 12 端到端冒烟

## 迁移约束（必须保留）

1. 不注入 fetch → 强制同步 getBinary
2. Module.wasmBinary 后门 → 绕过网络加载
3. 密钥流 Buffer.reverse()
4. new Module.WxIsaac64(String(decodeKey))
5. assertMp4 校验 bytes[4:8]==='ftyp'

## 验收标准

- npm run build 零错误，dist 含 .node.js + wasm
- 节点 lint 通过
- 冒烟脚本解密产出 bytes[4:8]==='ftyp'
- package.json 符合社区命名/keywords

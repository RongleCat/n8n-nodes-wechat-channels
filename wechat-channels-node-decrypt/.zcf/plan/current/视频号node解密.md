# 视频号 Node 纯 WASM 解密

- **创建**: 2026-06-25 16:54:11 CST
- **目标**: 用 Node 加载 WASM 解密视频号视频，摆脱无头浏览器
- **方案**: 方案 1 — 主进程 `vm.runInNewContext` 加载官方 Emscripten glue

## 输入
- share_url: `https://weixin.qq.com/sph/AXWxgCYFyG`
- token: `jMkcXvNKhmqqqVnNHJqP3SLSCgyFS51+1EHVjEm5bfmZrXWaF36aVxKROw==`
- 接口: `fetch_video_detail` (POST `/api/v1/wechat_channels/v2/fetch_video_detail`)

## 文件结构
```
wasm/  wasm_video_decode.{js,wasm} + decrypt.js (官方 XOR)
lib/   detail.js (详情接口) + wasm-decrypt.js (核心)
index.js  主入口 CLI
```

## 步骤进度
- [x] Step0 wasm 资源（3,785,516 B，魔数 \0asm ✅）
- [ ] Step1 lib/detail.js
- [ ] Step2 lib/wasm-decrypt.js
- [ ] Step3 index.js
- [ ] Step4 端到端验证

## 核心技术要点
- `Module.wasmBinary` 注入 → 绕过 XHR/fetch（第381行后门 + 第1218行 `!wasmBinary` 跳过）
- mock `self`/`document`；**不注入 fetch**（强制同步路径）
- `onRuntimeInitialized` 回调 → `Module.WxIsaac64` 就绪
- `wasm_isaac_generate(ptr,size)` 回调 → 密钥流 + **reverse 字节序**
- 复用官方 `wasm/decrypt.js` 的 `decryptBuffer`/`assertMp4`
- 零 npm 依赖（仅 Node 内置 `vm`/`fs`/`fetch`）

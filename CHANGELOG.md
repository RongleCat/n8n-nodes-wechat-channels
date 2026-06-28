# Changelog

## 1.0.0 (2026-06-28)

### 初始发布

- **WeChatChannelsDecrypt** 节点：下载并解密微信视频号加密视频
  - 输入：加密视频直链（`mediaUrl`）+ 解密密钥（`decodeKey`）
  - 基于 WebAssembly 生成密钥流完成 XOR 解密
  - 流式下载支持大文件
  - ftyp 校验确保解密成功
  - 输出明文 MP4 二进制文件
- 零运行时 npm 依赖（仅 Node.js 内置模块）
- 支持批量处理多个输入项
- 支持 *Continue On Fail* 错误处理模式


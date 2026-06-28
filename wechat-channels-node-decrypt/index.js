'use strict';
/**
 * 微信视频号 Node 纯 WASM 解密 — 主入口
 *
 * 全流程：详情接口 → 下载加密视频 → WASM 生成密钥流 → XOR 解密 → ftyp 校验
 *
 * 用法:
 *   node index.js <share_url> [--token TIKHUB_TOKEN] [--raw|--no-raw]
 * 示例:
 *   node index.js "https://weixin.qq.com/sph/AXWxgCYFyG"
 *
 * 环境变量 TIKHUB_TOKEN 可覆盖下方默认 token。
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { fetchVideoDetail } = require('./lib/detail');
const { createDecryptor } = require('./lib/wasm-decrypt');

// 默认 token（用户提供，可被 TIKHUB_TOKEN 环境变量覆盖）
const DEFAULT_TOKEN = 'jMkcXvNKhmqqqVnNHJqP3SLSCgyFS51+1EHVjEm5bfmZrXWaF36aVxKROw==';
const WASM_DIR = path.join(__dirname, 'wasm');
const OUTPUT_DIR = path.join(__dirname, 'output');

/** 解析命令行参数 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { shareUrl: null, token: process.env.TIKHUB_TOKEN || DEFAULT_TOKEN, raw: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--token') opts.token = args[++i];
    else if (a === '--no-raw') opts.raw = false;
    else if (a === '--raw') opts.raw = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-')) opts.shareUrl = a;
  }
  return opts;
}

function usage() {
  console.log(
    `用法: node index.js <share_url> [--token TIKHUB_TOKEN] [--raw|--no-raw]
示例: node index.js "https://weixin.qq.com/sph/AXWxgCYFyG"
选项:
  --token T   覆盖默认 TikHub token
  --raw       请求详情接口时使用原始响应（默认）
  --no-raw    使用精简解析结构
环境变量 TIKHUB_TOKEN 可覆盖默认 token`,
  );
}

/** 下载加密视频到本地（流式，支持大文件） */
async function downloadVideo(url, outPath, timeout = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
    const ws = fs.createWriteStream(outPath);
    // resp.body 是 Web ReadableStream，需转 Node 流再 pipeline
    await pipeline(Readable.fromWeb(resp.body), ws);
    return { outPath, size: fs.statSync(outPath).size };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.shareUrl) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. 详情接口
  console.log('[1/4] 请求视频号详情接口...');
  const detail = await fetchVideoDetail(opts.shareUrl, opts.token, { raw: opts.raw });
  console.log(`    objectId = ${detail.objectId}`);
  console.log(`    decodeKey = ${detail.decodeKey}`);
  console.log(`    mediaUrl  = ${detail.mediaUrl.slice(0, 90)}${detail.mediaUrl.length > 90 ? '...' : ''}`);
  console.log(`    ret       = ${detail.ret}`);

  // 留存原始详情便于排查字段结构
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${detail.objectId}_detail.json`),
    JSON.stringify(detail.raw, null, 2),
  );

  const encPath = path.join(OUTPUT_DIR, `${detail.objectId}_encrypted.mp4`);
  const decPath = path.join(OUTPUT_DIR, `${detail.objectId}_decrypted.mp4`);

  // 2. 下载加密视频
  console.log('[2/4] 下载加密视频...');
  const dl = await downloadVideo(detail.mediaUrl, encPath);
  console.log(`    已下载 ${(dl.size / 1024 / 1024).toFixed(2)} MB (${dl.size} B)`);

  // 3. WASM 解密
  console.log('[3/4] 加载 WASM 运行时并解密...');
  const dec = await createDecryptor(WASM_DIR);
  const result = await dec.decryptFile(encPath, detail.decodeKey, decPath);
  console.log(`    解密完成 ${(result.decryptedSize / 1024 / 1024).toFixed(2)} MB`);

  // 4. 校验 MP4 签名
  console.log('[4/4] 校验 MP4 ftyp 签名...');
  const head = fs.readFileSync(decPath).subarray(0, 16);
  const ftyp = head.subarray(4, 8).toString('latin1');
  const ok = ftyp === 'ftyp';
  console.log(`    bytes[4:8] = "${ftyp}"  ${ok ? '✅ ftyp 正常（解密成功）' : '❌ 非 ftyp（解密失败）'}`);
  console.log(`    头部 hex   = ${head.toString('hex')}`);

  if (!ok) {
    throw new Error('解密结果未通过 ftyp 校验，请检查 decodeKey 是否匹配');
  }

  console.log('\n✅ 全流程完成');
  console.log(`   解密文件: ${decPath}`);
  console.log(`   加密文件: ${encPath}`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e && (e.stack || e.message || e));
  process.exit(1);
});

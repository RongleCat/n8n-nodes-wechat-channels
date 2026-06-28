/**
 * postbuild 钩子：把 WASM 运行时资源（glue + 二进制）拷贝到 dist。
 *
 * `n8n-node build` 的静态文件拷贝仅覆盖 svg/json 等已知类型，不含 .wasm 与
 * Emscripten glue（wasm_video_decode.js），需在此补齐，否则节点运行时
 * createDecryptor(__dirname/wasm) 会因文件缺失而失败。
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'nodes', 'WeChatChannelsDecrypt', 'wasm');
const dst = join(root, 'dist', 'nodes', 'WeChatChannelsDecrypt', 'wasm');

if (!existsSync(src)) {
	console.error(`[copy-wasm] wasm 源目录不存在: ${src}`);
	process.exit(1);
}

mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-wasm] 已拷贝 wasm 资源 →', dst);

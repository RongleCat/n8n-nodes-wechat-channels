'use strict';
/**
 * 临时冒烟脚本：验证 dist 产物上 WASM 加载 + 密钥流生成链路。
 * 不依赖网络/TikHub，仅证明 vm.runInNewContext 加载 Emscripten glue、
 * Module.WxIsaac64 embind 绑定、密钥流回调 + reverse 字节序在编译产物上正常。
 */
const path = require('node:path');
const { createDecryptor, KEYSTREAM_SIZE } = require('../dist/nodes/WeChatChannelsDecrypt/wasmDecrypt.js');

(async () => {
	const wasmDir = path.join(__dirname, '..', 'dist', 'nodes', 'WeChatChannelsDecrypt', 'wasm');
	console.log('[smoke] 加载 WASM 解密器...', wasmDir);
	const t0 = Date.now();
	const dec = await createDecryptor(wasmDir);
	console.log(`[smoke] WASM 就绪 (${Date.now() - t0}ms)`);

	// decodeKey 须为数字字符串：WxIsaac64 内部用 std::stoull 转 uint64
	const ks = await dec.generateKeystream('1234567890123456');
	const lenOk = ks.length === KEYSTREAM_SIZE;
	const nonZero = !ks.every((b) => b === 0);
	console.log('[smoke] keystream length :', ks.length, lenOk ? '✓' : '✗');
	console.log('[smoke] keystream head   :', ks.subarray(0, 16).toString('hex'));
	console.log('[smoke] non-zero         :', nonZero ? '✓' : '✗');

	if (!lenOk || !nonZero) {
		console.error('[smoke] ❌ 链路异常');
		process.exit(1);
	}
	console.log('[smoke] ✅ 加载链路验证通过');
})().catch((e) => {
	console.error('[smoke] ❌', e && (e.stack || e.message || e));
	process.exit(1);
});

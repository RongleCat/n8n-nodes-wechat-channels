/* eslint-disable @typescript-eslint/no-explicit-any -- Emscripten WASM Module 为运行时动态形状，互操作需 any */
/**
 * 核心：Node 纯 WASM 解密（摆脱无头浏览器）
 *
 * 原理：
 *   1. 官方 wasm_video_decode.js 是 Emscripten 按 Web Worker 目标编译的 glue，
 *      但本质是标准 Emscripten 模块（无 Worker 消息循环）。
 *   2. 通过 vm.runInNewContext 在 Node 中加载它，注入：
 *      - Worker 环境 mock（self / document / location）满足 glue 第 69 行
 *      - Module.wasmBinary 二进制后门（第 381 行）→ 绕过 XHR/fetch 加载
 *      - 故意【不注入 fetch】→ 第 1219 行 typeof fetch==='function' 为 false → 走同步 getBinary
 *   3. glue 末尾自动 run() → 异步实例化 → onRuntimeInitialized 回调 → Module.WxIsaac64 就绪
 *   4. new Module.WxIsaac64(decodeKey).generate(131072) → 回调 wasm_isaac_generate(ptr,size)
 *      → 拷贝 + reverse 字节序（worker.html 第 67 行）→ 128KB 密钥流
 *   5. XOR 解密前 128KB（复用 decrypt.ts，纯 Node Buffer）
 *
 * @module wechatChannelsDecrypt/wasmDecrypt
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { decryptBuffer as xorDecrypt, assertMp4, KEYSTREAM_SIZE } from './decrypt';

// Emscripten glue 运行所需的标准全局白名单
const SANDBOX_GLOBALS = [
	'WebAssembly', 'console',
	'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
	'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
	'Uint8ClampedArray', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
	'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
	'TextDecoder', 'TextEncoder',
	'Promise', 'Math', 'Date', 'JSON', 'Reflect', 'Proxy', 'Symbol', 'BigInt',
	'parseInt', 'parseFloat', 'isNaN', 'isFinite',
	'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
	'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError',
	'String', 'Number', 'Boolean', 'Object', 'Array', 'Function', 'RegExp',
	'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
	'performance', 'atob', 'btoa', 'crypto',
] as const;

/** Emscripten Module 实例（动态形状，按 any 处理） */
type WasmModule = any;

/** 构造 vm sandbox：注入标准全局 + Worker mock + wasm 二进制后门 */
function buildSandbox(wasmBinary: Buffer): Record<string, any> {
	const sandbox: Record<string, any> = {};
	for (const k of SANDBOX_GLOBALS) {
		if (k in globalThis) sandbox[k] = (globalThis as any)[k];
	}
	sandbox.performance = sandbox.performance || { now: () => Date.now() };

	// Worker 环境 mock（满足 glue 第 69 行 self.location.href）
	sandbox.location = { href: 'http://localhost/wasm_video_decode.js' };
	sandbox.document = { title: '', currentScript: { src: 'wasm_video_decode.js' } };
	sandbox.self = sandbox;
	sandbox.window = sandbox;

	// 关键：不注入 fetch → 强制 glue 走同步 getBinary
	// 关键：Module.wasmBinary 后门 → 第 381 行直接使用，绕过网络加载
	sandbox.VTS_WASM_URL = 'wasm_video_decode.wasm';
	sandbox.Module = { wasmBinary };

	return sandbox;
}

/** 加载 glue 并实例化 WASM，返回就绪的 { Module, sandbox } */
function loadWasm(wasmDir: string): Promise<{ Module: WasmModule; sandbox: Record<string, any> }> {
	const gluePath = path.join(wasmDir, 'wasm_video_decode.js');
	const wasmPath = path.join(wasmDir, 'wasm_video_decode.wasm');
	const glueCode = fs.readFileSync(gluePath, 'utf8');
	const wasmBinary = fs.readFileSync(wasmPath);

	const sandbox = buildSandbox(wasmBinary);
	vm.createContext(sandbox);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error('WASM 运行时初始化超时（60s）— 检查是否缺失全局或实例化失败'));
		}, 60000);

		sandbox.Module.onRuntimeInitialized = () => {
			clearTimeout(timer);
			if (!sandbox.Module.WxIsaac64) {
				reject(new Error('WASM 已就绪但未注册 Module.WxIsaac64（embind 初始化异常）'));
				return;
			}
			resolve({ Module: sandbox.Module, sandbox });
		};
		sandbox.Module.onAbort = (reason: unknown) => {
			clearTimeout(timer);
			reject(new Error(`WASM 运行时 abort: ${reason}`));
		};

		try {
			// glue 末尾自动 run() → 异步实例化 → 触发 onRuntimeInitialized
			vm.runInNewContext(glueCode, sandbox, { filename: 'wasm_video_decode.js' });
		} catch (err) {
			clearTimeout(timer);
			reject(new Error(`glue 同步加载失败: ${(err as Error)?.stack || (err as Error)?.message || err}`));
		}
	});
}

/** 解密器实例 */
export interface Decryptor {
	/** 生成 128KB 密钥流（已 reverse 字节序） */
	generateKeystream(decodeKey: string, size?: number): Promise<Buffer>;
	/** 解密内存中的加密视频 Buffer（生成密钥流 → XOR → ftyp 校验） */
	decryptBuffer(encrypted: Buffer, decodeKey: string): Promise<Buffer>;
	/** 解密整个文件（读盘 → 解密 → 校验 → 写盘） */
	decryptFile(inputPath: string, decodeKey: string, outputPath: string): Promise<{
		outputPath: string;
		encryptedSize: number;
		decryptedSize: number;
	}>;
}

/**
 * 创建解密器（一次实例化 WASM，可多次生成密钥流）
 * @param wasmDir 含 wasm_video_decode.{js,wasm} 的目录
 */
export async function createDecryptor(wasmDir: string): Promise<Decryptor> {
	const { Module, sandbox } = await loadWasm(wasmDir);

	// 密钥流回调 sink：generateKeystream 调用时替换
	let keystreamSink: ((ptr: number, len: number) => void) | null = null;
	sandbox.wasm_isaac_generate = function (ptr: number, len: number) {
		if (keystreamSink) keystreamSink(ptr, len);
	};

	/**
	 * 生成 128KB 密钥流
	 * @param decodeKey 解密密钥
	 * @param size 密钥流长度，默认 131072
	 * @returns 已 reverse 字节序的密钥流 Buffer
	 */
	function generateKeystream(decodeKey: string, size: number = KEYSTREAM_SIZE): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('密钥流生成超时（30s）— generate 回调未触发')),
				30000,
			);

			keystreamSink = (ptr, len) => {
				clearTimeout(timer);
				try {
					// 从 wasm HEAP 拷贝（回调返回后内存可能被复用），并 reverse 字节序
					const view = Module.HEAPU8.subarray(ptr, ptr + len);
					const buf = Buffer.from(view); // 深拷贝
					buf.reverse(); // worker.html 第 67 行：必须反转
					resolve(buf);
				} catch (e) {
					reject(new Error(`密钥流拷贝失败: ${(e as Error)?.message || e}`));
				}
			};

			try {
				// WxIsaac64 构造参数为 std::string（embind 绑定），必须传字符串
				const decryptor = new Module.WxIsaac64(String(decodeKey));
				decryptor.generate(size);
				decryptor.delete();
			} catch (e) {
				clearTimeout(timer);
				reject(new Error(`WxIsaac64 调用失败: ${(e as Error)?.stack || (e as Error)?.message || e}`));
			}
		});
	}

	/** 解密内存 Buffer（不落盘） */
	async function decryptBufferEncrypted(encrypted: Buffer, decodeKey: string): Promise<Buffer> {
		const keystream = await generateKeystream(decodeKey);
		const decrypted = xorDecrypt(encrypted, keystream);
		assertMp4(decrypted); // 校验 bytes[4:8] === 'ftyp'
		return decrypted;
	}

	/** 解密整个文件（读盘 → 密钥流 → XOR → 校验 → 写盘） */
	async function decryptFile(inputPath: string, decodeKey: string, outputPath: string) {
		const encrypted = fs.readFileSync(inputPath);
		const decrypted = await decryptBufferEncrypted(encrypted, decodeKey);
		fs.writeFileSync(outputPath, decrypted);
		return { outputPath, encryptedSize: encrypted.length, decryptedSize: decrypted.length };
	}

	return {
		generateKeystream,
		decryptBuffer: decryptBufferEncrypted,
		decryptFile,
	};
}

export { KEYSTREAM_SIZE };

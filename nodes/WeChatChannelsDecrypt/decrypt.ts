/**
 * 视频解密核心（纯函数，Node.js 端执行）
 *
 * 微信视频号仅加密文件前 KEYSTREAM_SIZE(128KB) 字节，其余为明文。
 * 解密无需浏览器：浏览器只负责用 WASM 生成 128KB 密钥流，XOR 在此完成。
 *
 * @module wechatChannelsDecrypt/decrypt
 */

/** 微信加密作用的字节数（密钥流长度） */
export const KEYSTREAM_SIZE = 131072;

/**
 * 对加密视频执行 XOR 解密
 * @param encrypted 原始加密视频 Buffer
 * @param keystream 128KB 密钥流 Buffer
 * @returns 解密后的视频 Buffer（明文部分原样保留）
 */
export function decryptBuffer(encrypted: Buffer, keystream: Buffer): Buffer {
	const decrypted = Buffer.from(encrypted); // 拷贝一份，明文部分原样保留
	const decryptLen = Math.min(KEYSTREAM_SIZE, encrypted.length, keystream.length);
	for (let i = 0; i < decryptLen; i++) {
		decrypted[i] = encrypted[i] ^ keystream[i];
	}
	return decrypted;
}

/**
 * 校验解密结果是否为合法 MP4（偏移 4 处应为 ftyp 签名）
 * @param buffer 解密后的视频 Buffer
 * @throws 当签名缺失时（通常是 decodeKey 不匹配）
 */
export function assertMp4(buffer: Buffer): void {
	const ftyp = buffer.toString('utf8', 4, 8);
	if (ftyp !== 'ftyp') {
		throw new Error('解密失败：未找到 MP4 ftyp 签名，请检查 decodeKey');
	}
}

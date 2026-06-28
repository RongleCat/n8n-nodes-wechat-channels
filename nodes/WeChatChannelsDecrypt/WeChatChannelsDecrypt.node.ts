import type {
	IExecuteFunctions,
	IBinaryData,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDecryptor } from './wasmDecrypt';

/**
 * WeChat Channels Decrypt —— 微信视频号加密视频下载与解密节点
 *
 * 职责边界：本节点【不】请求视频号详情接口，仅接收上游已获取的解密必需参数
 * （mediaUrl + decodeKey），完成「下载加密视频 → WASM 生成密钥流 → XOR 解密
 * → ftyp 校验 → 输出明文 MP4 二进制」。
 *
 * 选择 programmatic-style：核心逻辑涉及 vm.runInNewContext 加载 Emscripten WASM、
 * 流式下载、Buffer XOR 与签名校验，declarative-style 无法表达。
 *
 * 说明：本节点依赖 node:vm/node:fs 等本地能力运行 WASM 解密，仅适用于自托管 n8n，
 * 不兼容 n8n Cloud 沙箱。
 */
export class WeChatChannelsDecrypt implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WeChat Channels Decrypt',
		name: 'weChatChannelsDecrypt',
		subtitle: 'Download & Decrypt',
		icon: {
			light: 'file:wechatChannelsDecrypt.svg',
			dark: 'file:wechatChannelsDecrypt.dark.svg',
		},
		group: ['transform'],
		version: [1],
		description: '下载并解密微信视频号加密视频（WASM 密钥流），输出明文 MP4 二进制',
		defaults: {
			name: 'WeChat Channels Decrypt',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: '加密视频直链',
				name: 'mediaUrl',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				required: true,
				description: '视频号加密视频的下载直链，需含 urlToken 鉴权（来自详情接口 media[0] 的直链与 urlToken 拼接）',
			},
			{
				displayName: '解密密钥',
				name: 'decodeKey',
				type: 'string',
				default: '',
				required: true,
				description: 'WASM 生成密钥流的种子（来自详情接口 media[0].decodeKey）',
			},
			{
				displayName: '输出文件名',
				name: 'outputFileName',
				type: 'string',
				default: 'video.mp4',
				description: '输出二进制文件的命名，建议扩展名 .mp4',
			},
			{
				displayName: '下载超时 (秒)',
				name: 'downloadTimeout',
				type: 'number',
				default: 300,
				description: '下载加密视频的超时时间，视频号 CDN 直链有效期较短，建议保持充足',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// WASM 解密器一次实例化，循环复用（避免每个 item 重复加载 3.6MB wasm）
		const wasmDir = path.join(__dirname, 'wasm');
		const decryptor = await createDecryptor(wasmDir);

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			// 临时文件：用 pid + 随机串避免并发与重名
			const stamp = `${process.pid}-${itemIndex}-${Math.random().toString(36).slice(2, 10)}`;
			const tmpEnc = path.join(os.tmpdir(), `wcd-enc-${stamp}.mp4`);
			const tmpDec = path.join(os.tmpdir(), `wcd-dec-${stamp}.mp4`);

			try {
				const mediaUrl = this.getNodeParameter('mediaUrl', itemIndex, '') as string;
				const decodeKey = this.getNodeParameter('decodeKey', itemIndex, '') as string;
				const outputFileName = this.getNodeParameter('outputFileName', itemIndex, 'video.mp4') as string;
				const downloadTimeout = this.getNodeParameter('downloadTimeout', itemIndex, 300) as number;

				if (!mediaUrl || !decodeKey) {
					throw new NodeOperationError(
						this.getNode(),
						'mediaUrl 与 decodeKey 均为必填项，请先通过视频号详情接口获取',
						{ itemIndex },
					);
				}

				// 1. 下载加密视频到临时文件（流式，支持大文件）
				await downloadTo(mediaUrl, tmpEnc, downloadTimeout * 1000);

				// 2. WASM 解密 + ftyp 校验（decryptFile 内部完成校验，失败会抛错）
				const result = await decryptor.decryptFile(tmpEnc, decodeKey, tmpDec);
				const decrypted = fs.readFileSync(tmpDec);

				// 3. 输出明文 MP4 二进制
				const binaryData: IBinaryData = await this.helpers.prepareBinaryData(
					decrypted,
					outputFileName,
					'video/mp4',
				);

				returnData.push({
					json: {
						success: true,
						fileName: outputFileName,
						encryptedSize: result.encryptedSize,
						decryptedSize: result.decryptedSize,
						mediaUrl,
					},
					binary: {
						data: binaryData,
					},
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: (error as Error).message,
							mediaUrl: this.getNodeParameter('mediaUrl', itemIndex, ''),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// 解密失败（ftyp 校验不过）属于配置/数据问题，用 NodeOperationError 上报
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			} finally {
				// 清理临时文件（无论成功失败）
				safeUnlink(tmpEnc);
				safeUnlink(tmpDec);
			}
		}

		return [returnData];
	}
}

/** 流式下载加密视频到本地文件 */
async function downloadTo(url: string, outPath: string, timeoutMs: number): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
		if (!resp.ok) {
			throw new ApplicationError(`下载加密视频失败：HTTP ${resp.status}`);
		}
		if (!resp.body) {
			throw new ApplicationError('下载加密视频失败：响应无 body');
		}
		const ws = fs.createWriteStream(outPath);
		// resp.body 是 Web ReadableStream，需转 Node 流再 pipeline
		await pipeline(Readable.fromWeb(resp.body as ReadableStream<Uint8Array>), ws);
	} finally {
		clearTimeout(timer);
	}
}

/** 静默删除文件（忽略不存在） */
function safeUnlink(p: string): void {
	try {
		fs.unlinkSync(p);
	} catch {
		/* 临时文件清理失败不影响主流程 */
	}
}

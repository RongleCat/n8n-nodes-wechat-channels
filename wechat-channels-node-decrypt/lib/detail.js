'use strict';
/**
 * TikHub 视频号详情接口请求 + 字段提取
 *
 * 端点: POST https://api.tikhub.io/api/v1/wechat_channels/v2/fetch_video_detail
 * 入参: { share_url, raw }
 * 返回: 加密视频直链 media[0].url + 解密密钥 decodeKey
 */

const TIKHUB_BASE = 'https://api.tikhub.io';
const DETAIL_PATH = '/api/v1/wechat_channels/v2/fetch_video_detail';

/**
 * 请求视频号详情
 * @param {string} shareUrl  视频号短链，如 https://weixin.qq.com/sph/AXWxgCYFyG
 * @param {string} token     TikHub Bearer token
 * @param {{raw?:boolean, timeout?:number}} [opts]
 * @returns {Promise<{objectId:string, decodeKey:string, mediaUrl:string, ret:number, raw:object}>}
 */
async function fetchVideoDetail(shareUrl, token, { raw = true, timeout = 30000 } = {}) {
  if (!shareUrl) throw new Error('shareUrl 不能为空');
  if (!token) throw new Error('token 不能为空');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(TIKHUB_BASE + DETAIL_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ share_url: shareUrl, raw }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`详情接口 HTTP ${resp.status}: ${await safeText(resp)}`);
    }

    const json = await resp.json();
    if (json.code !== 200) {
      throw new Error(`详情接口业务错误 code=${json.code}: ${json.message || JSON.stringify(json).slice(0, 300)}`);
    }

    return parseDetail(json);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从响应中提取解密所需核心字段
 * 解析路径参考 collect.py 第 348-364 行
 */
function parseDetail(json) {
  // ResponseModel.data 为 anyOf(string|null)：raw=true 时可能是 JSON 字符串
  let data = json.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      /* 保持原值，后续校验会报错 */
    }
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`详情数据为空或非对象: ${JSON.stringify(json).slice(0, 500)}`);
  }

  // 微信 baseResponse.ret：0 表示成功
  const ret = data?.baseResponse?.ret ?? data?.ret ?? 0;

  // url / urlToken / decodeKey 均取自同一 media 元素，保证三者严格配套
  // （腾讯 CDN url 需拼接 urlToken 鉴权，否则 400 "token not exist"，X-Errno -5103144）
  const mediaList = data?.objectDesc?.media ?? [];
  const media0 = mediaList[0] || {};
  const mediaUrl = (media0.url || '') + (media0.urlToken || '');
  const decodeKey = String(media0.decodeKey ?? data.decodeKey ?? '');

  // objectId：用于命名输出文件（顶层 id 优先，回退 objectNonceId）
  const objectId = String(data.id ?? data.objectId ?? data?.objectDesc?.objectId ?? data.objectNonceId ?? 'unknown');

  if (!media0.url) {
    throw new Error(`未提取到视频直链 media[0].url，原始数据片段: ${JSON.stringify(data).slice(0, 800)}`);
  }
  if (!decodeKey) {
    throw new Error(`未提取到 decodeKey，原始数据片段: ${JSON.stringify(data).slice(0, 800)}`);
  }

  return { objectId, decodeKey, mediaUrl, ret, raw: data };
}

async function safeText(resp) {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return '';
  }
}

module.exports = { fetchVideoDetail, TIKHUB_BASE, DETAIL_PATH };

/* 真实站点探针的目标发现器。
 *
 * 规则背景：公开仓库不得固化具体验证页标识（BV 号、微博 uid/mid 等），但每轮改动
 * 又必须做真实站点验证。因此探针默认在运行时从平台公开入口页选出一个目标，
 * 具体标识只出现在本地探针输出里，不进入版本化文件。
 * 维护者仍可用 `--url=` 显式指定目标。
 *
 * 只读：只打开公开入口页读取链接，不登录、不写任何站内状态。
 */
const ENTRIES = {
  bilibili: {
    url: 'https://www.bilibili.com/',
    accept: (href) => /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(href),
    normalize: (href) => {
      const match = href.match(/^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]+)/);
      return match ? 'https://www.bilibili.com/video/' + match[1] : '';
    },
  },
  weibo: {
    url: 'https://weibo.com/',
    accept: (href) => /^https:\/\/weibo\.com\/\d{5,}\/[A-Za-z0-9]{6,}/.test(href),
    normalize: (href) => {
      const match = href.match(/^https:\/\/weibo\.com\/(\d{5,})\/([A-Za-z0-9]{6,})/);
      return match ? 'https://weibo.com/' + match[1] + '/' + match[2] : '';
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 从平台公开入口页发现若干可用于只读探针的目标 URL，按出现顺序去重。 */
async function discoverTargets(browser, platform, options) {
  const entry = ENTRIES[platform];
  if (!entry) throw new Error('未知平台：' + platform);
  const settle = (options && options.settleMs) || 4000;
  const limit = (options && options.limit) || 6;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(settle);
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.href));
    const seen = new Set();
    const found = [];
    for (const href of hrefs) {
      if (!entry.accept(href)) continue;
      const normalized = entry.normalize(href);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      found.push(normalized);
      if (found.length >= limit) break;
    }
    return found;
  } catch (error) {
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/** 便捷形式：只取第一个目标。 */
async function discoverTarget(browser, platform, options) {
  const found = await discoverTargets(browser, platform, options);
  return found[0] || '';
}

/** 供报告使用的脱敏形式，避免把具体页面标识写进可能被提交的文本。 */
function redactTarget(url) {
  if (!url) return '';
  if (/bilibili\.com\/video\//.test(url)) return 'bilibili.com/video/...';
  if (/weibo\.com\/\d+\//.test(url)) return 'weibo.com/...';
  try { return new URL(url).hostname + '/...'; } catch (error) { return '...'; }
}

module.exports = { discoverTarget, discoverTargets, redactTarget, ENTRIES };

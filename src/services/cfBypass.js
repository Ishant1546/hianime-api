/**
 * cfBypass.js — Cloudflare bypass for hianime.ad
 *
 * Strategy (in order):
 *   1. Plain axios with full Chrome fingerprint headers + cf-clearance cookie (from env)
 *   2. If still blocked → Puppeteer (only works on VPS/local, not Vercel)
 *
 * For Vercel deploy: set CF_CLEARANCE env variable with a valid cf_clearance cookie
 * from hianime.ad (get it from browser DevTools → Application → Cookies)
 *
 * ENV variables:
 *   CF_CLEARANCE     — cf_clearance cookie value from hianime.ad
 *   CF_USER_AGENT    — exact User-Agent you used when getting cf_clearance
 */

import axios from 'axios';
import config from '../config/config.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const getEnv = (key, def = '') =>
  (typeof process !== 'undefined' && process.env[key]) || def;

const CF_CLEARANCE  = getEnv('CF_CLEARANCE', '');
const CF_UA         = getEnv('CF_USER_AGENT',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

const PLAIN_TIMEOUT  = 15000;
const PUPPET_TIMEOUT = 25000;

// ─── Build headers that look like a real Chrome browser ───────────────────────
function buildHeaders(extraHeaders = {}, referer = null) {
  const headers = {
    'User-Agent': CF_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124","Google Chrome";v="124","Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
  };

  if (referer) headers['Referer'] = config.baseurl + referer;
  if (CF_CLEARANCE) headers['Cookie'] = `cf_clearance=${CF_CLEARANCE}`;

  return { ...headers, ...extraHeaders };
}

function buildAjaxHeaders(referer = '/') {
  return buildHeaders({
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Referer': config.baseurl + referer,
  }, null);
}

// ─── CF block detection ───────────────────────────────────────────────────────
function isCfBlocked(status, html) {
  if (status === 403 || status === 503) return true;
  if (typeof html !== 'string') return false;
  return html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         html.includes('Checking your browser') ||
         html.includes('Enable JavaScript and cookies') ||
         html.includes('DDoS protection by Cloudflare');
}

// ─── Puppeteer (VPS/local only, skip on Vercel) ───────────────────────────────
const IS_VERCEL = getEnv('VERCEL', '') === '1' || getEnv('VERCEL_ENV', '') !== '';

let browser = null;
let browserBusy = 0;
const pageQueue = [];
const MAX_CONCURRENT = 4;

async function getPuppeteer() {
  if (IS_VERCEL) return null;
  try { return (await import('puppeteer-core')).default; } catch {}
  try { return (await import('puppeteer')).default; } catch {}
  return null;
}

async function getBrowser() {
  const pptr = await getPuppeteer();
  if (!pptr) return null;

  if (browser) {
    try { await browser.version(); return browser; } catch { browser = null; }
  }

  const { existsSync } = await import('fs');
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
  const executablePath = chromePaths.find(p => existsSync(p));

  try {
    browser = await pptr.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
      ...(executablePath ? { executablePath } : {}),
    });
    console.log('[cfBypass] Browser launched');
  } catch (err) {
    console.error('[cfBypass] Browser launch failed:', err.message);
    browser = null;
  }
  return browser;
}

async function acquirePage() {
  const b = await getBrowser();
  if (!b) return null;
  if (browserBusy >= MAX_CONCURRENT) {
    await new Promise(r => pageQueue.push(r));
  }
  browserBusy++;
  const page = await b.newPage();
  await page.setUserAgent(CF_UA);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

async function releasePage(page) {
  if (!page) return;
  await page.close().catch(() => {});
  browserBusy--;
  if (pageQueue.length) pageQueue.shift()();
}

async function puppeteerFetch(url) {
  const page = await acquirePage();
  if (!page) return null;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PUPPET_TIMEOUT });
    await page.waitForFunction(
      () => !document.title.includes('Just a moment') && !document.querySelector('#cf-challenge-wrapper'),
      { timeout: PUPPET_TIMEOUT }
    ).catch(() => {});
    const html = await page.content();
    await releasePage(page);
    return html;
  } catch (err) {
    await releasePage(page);
    throw err;
  }
}

async function puppeteerAjax(ajaxUrl, referer, extraHeaders) {
  const page = await acquirePage();
  if (!page) return null;
  try {
    await page.goto(config.baseurl + referer, { waitUntil: 'networkidle2', timeout: PUPPET_TIMEOUT });
    await page.waitForFunction(
      () => !document.title.includes('Just a moment'),
      { timeout: PUPPET_TIMEOUT }
    ).catch(() => {});
    const result = await page.evaluate(async (url, hdrs) => {
      const res = await fetch(url, { headers: hdrs, credentials: 'include' });
      return res.text();
    }, ajaxUrl, extraHeaders);
    await releasePage(page);
    return JSON.parse(result);
  } catch (err) {
    await releasePage(page);
    throw err;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch an HTML page from hianime.ad
 */
export async function cfFetch(endpoint) {
  const url = config.baseurl + endpoint;

  // 1) Plain fetch with Chrome headers + cf_clearance cookie
  try {
    const { data, status } = await axios.get(url, {
      timeout: PLAIN_TIMEOUT,
      headers: buildHeaders({}, endpoint),
      validateStatus: s => s < 600,
    });
    if (!isCfBlocked(status, data)) {
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
    console.warn(`[cfBypass] Plain blocked (${status}): ${endpoint}`);
  } catch (err) {
    console.warn(`[cfBypass] Plain error (${err.message}): ${endpoint}`);
  }

  // 2) Puppeteer fallback (VPS only)
  if (!IS_VERCEL) {
    try {
      const html = await puppeteerFetch(url);
      if (html) return html;
    } catch (err) {
      console.error('[cfBypass] Puppeteer failed:', err.message);
    }
  }

  // 3) Give a clear error message
  if (IS_VERCEL && !CF_CLEARANCE) {
    throw new Error('CF_CLEARANCE env not set. Get cf_clearance cookie from hianime.ad and add to Vercel env vars.');
  }
  throw new Error(`Failed to fetch ${endpoint} — CF bypass unsuccessful`);
}

/**
 * Fetch a JSON AJAX endpoint from hianime.ad
 */
export async function cfFetchAjax(ajaxPath, referer = '/') {
  const url = config.baseurl + ajaxPath;
  const headers = buildAjaxHeaders(referer);

  // 1) Plain fetch
  try {
    const { data, status } = await axios.get(url, {
      timeout: PLAIN_TIMEOUT,
      headers,
      validateStatus: s => s < 600,
    });
    const body = typeof data === 'string' ? data : '';
    if (!isCfBlocked(status, body)) {
      return typeof data === 'object' ? data : JSON.parse(data);
    }
    console.warn(`[cfBypass] AJAX plain blocked (${status}): ${ajaxPath}`);
  } catch (err) {
    console.warn(`[cfBypass] AJAX plain error (${err.message}): ${ajaxPath}`);
  }

  // 2) Puppeteer fallback
  if (!IS_VERCEL) {
    try {
      const result = await puppeteerAjax(url, referer, headers);
      if (result) return result;
    } catch (err) {
      console.error('[cfBypass] Puppeteer AJAX failed:', err.message);
    }
  }

  if (IS_VERCEL && !CF_CLEARANCE) {
    throw new Error('CF_CLEARANCE env not set. Add cf_clearance cookie from hianime.ad to Vercel env vars.');
  }
  throw new Error(`Failed AJAX ${ajaxPath} — CF bypass unsuccessful`);
}

/**
 * Resolve embed URL to HLS stream
 */
export async function resolveEmbedStream(embedUrl) {
  try {
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': CF_UA, 'Referer': config.baseurl },
      timeout: 10000,
    });

    const srcMatch = html.match(/const src\s*=\s*"(https?:\/\/[^"]+?\/master\.m3u8[^"]*)"/);
    if (srcMatch) return parseMasterM3u8(srcMatch[1], embedUrl);

    const unpacked = unpackPackedScript(html);
    if (unpacked) {
      const hls4 = unpacked.match(/"hls4":"([^"]+)"/);
      const hls3 = unpacked.match(/"hls3":"([^"]+)"/);
      const streamUrl = hls4?.[1] || hls3?.[1];
      if (streamUrl) {
        const domain = new URL(embedUrl).hostname;
        const full = streamUrl.startsWith('/') ? `https://${domain}${streamUrl}` : streamUrl;
        return parseMasterM3u8(full, embedUrl);
      }
    }
  } catch {}

  return { embed_url: embedUrl, master_m3u8: null, subtitle: null, variants: [], note: 'Could not resolve stream' };
}

function unpackPackedScript(html) {
  const idx = html.indexOf("eval(function(p,a,c,k,e,d)");
  if (idx === -1) return null;
  const fnEndIdx = html.indexOf("}('", idx);
  if (fnEndIdx === -1) return null;
  const callStart = fnEndIdx + 1;
  let depth = 0, end = -1;
  for (let i = callStart; i < html.length; i++) {
    if (html[i] === '(') depth++;
    else if (html[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) return null;
  const argsStr = html.substring(callStart + 1, end - 1);
  const args = [];
  let d = 0, cur = '', inStr = false, sq = false;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inStr) { cur += ch; if (ch === (sq ? "'" : '"') && argsStr[i-1] !== '\\') inStr = false; }
    else if (ch === "'" || ch === '"') { cur += ch; inStr = true; sq = ch === "'"; }
    else if ('([{'.includes(ch)) { d++; cur += ch; }
    else if (')]}'.includes(ch)) { d--; cur += ch; }
    else if (ch === ',' && d === 0) { args.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  if (args.length < 4) return null;
  const packedStr = args[0].replace(/^'|'$/g, '');
  const radix = parseInt(args[1]);
  const count = parseInt(args[2]);
  const dictMatch = args[3].match(/^'(.+)'\.split/);
  if (!dictMatch) return null;
  const dict = dictMatch[1].split('|');
  let result = packedStr;
  for (let i = 0; i < Math.min(count, dict.length); i++) {
    if (dict[i]) result = result.replace(new RegExp('\\b' + i.toString(radix) + '\\b', 'g'), dict[i]);
  }
  return result;
}

async function parseMasterM3u8(masterUrl, embedUrl) {
  const { data: m3u8 } = await axios.get(masterUrl, {
    headers: { 'User-Agent': CF_UA, 'Referer': new URL(embedUrl).origin },
    timeout: 10000,
  });
  const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
  const variants = [];
  const lines = m3u8.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1] || 'unknown';
    const bw  = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0');
    const name = lines[i].match(/NAME="([^"]+)"/)?.[1] || res;
    if (i + 1 < lines.length && !lines[i+1].startsWith('#')) {
      const pl = lines[i+1].trim();
      variants.push({ name, resolution: res, bandwidth_kbps: Math.round(bw/1000), url: pl.startsWith('http') ? pl : base + pl });
    }
  }
  variants.sort((a, b) => b.bandwidth_kbps - a.bandwidth_kbps);
  return { master_m3u8: masterUrl, subtitle: null, variants };
}

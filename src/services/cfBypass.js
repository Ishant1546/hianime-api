/**
 * cfBypass.js — Cloudflare bypass using Puppeteer (real headless browser).
 *
 * hianime.ad is behind Cloudflare, so plain axios/fetch gets 403.
 * This module:
 *   1. Tries plain axios first (fast, no overhead).
 *   2. If CF challenge detected (403 / "Just a moment"), falls back to Puppeteer.
 *   3. Puppeteer solves the JS challenge automatically (headless Chrome).
 *   4. Reuses a single browser instance + page pool for performance.
 *
 * Usage:
 *   import { cfFetch, cfFetchAjax } from './cfBypass.js';
 *   const html = await cfFetch('/home');              // returns HTML string
 *   const json = await cfFetchAjax('/ajax/v2/...');  // returns parsed JSON
 */

import axios from 'axios';
import config from '../config/config.js';

const UA = config.headers['User-Agent'] ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PUPPET_TIMEOUT = 20000;
const MAX_CONCURRENT  = 6;
const PLAIN_TIMEOUT   = 12000;

// ─── Puppeteer lazy-load ──────────────────────────────────────────────────────
let puppeteer = null;
async function getPuppeteer() {
  if (puppeteer) return puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; return puppeteer; } catch {}
  try { puppeteer = (await import('puppeteer')).default;      return puppeteer; } catch {}
  return null;
}

// ─── Browser singleton ────────────────────────────────────────────────────────
let browser      = null;
let browserBusy  = 0;
const pageQueue  = [];

async function getBrowser() {
  const pptr = await getPuppeteer();
  if (!pptr) return null;

  if (browser) {
    try { await browser.version(); return browser; } catch { browser = null; }
  }

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];

  // Try to find a local Chrome / Chromium binary
  const { existsSync } = await import('fs');
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const executablePath = chromePaths.find(p => existsSync(p));

  try {
    browser = await pptr.launch({
      headless: true,
      args: launchArgs,
      ...(executablePath ? { executablePath } : {}),
    });
    console.log('[cfBypass] Browser launched:', executablePath || 'bundled');
  } catch (err) {
    console.error('[cfBypass] Failed to launch browser:', err.message);
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
  await page.setUserAgent(UA);
  // Hide webdriver flag
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

// ─── Packed JS unpacker (p,a,c,k,e,d) ────────────────────────────────────────
function unpackPackedScript(html) {
  const idx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (idx === -1) return null;

  const fnEndIdx = html.indexOf("}('", idx);
  if (fnEndIdx === -1) return null;

  const callStart = fnEndIdx + 1;
  let depth = 0, end = -1;
  for (let i = callStart; i < html.length; i++) {
    if      (html[i] === '(') depth++;
    else if (html[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) return null;

  const argsStr = html.substring(callStart + 1, end - 1);
  const args = [];
  let d = 0, cur = '', inStr = false, sq = false;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inStr) {
      cur += ch;
      if (ch === (sq ? "'" : '"') && argsStr[i - 1] !== '\\') inStr = false;
    } else if (ch === "'" || ch === '"') {
      cur += ch; inStr = true; sq = (ch === "'");
    } else if (ch === '(' || ch === '[' || ch === '{') { d++; cur += ch; }
    else if (ch === ')' || ch === ']' || ch === '}') { d--; cur += ch; }
    else if (ch === ',' && d === 0 && !inStr) { args.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  if (args.length < 4) return null;

  const packedStr  = args[0].replace(/^'|'$/g, '');
  const radix      = parseInt(args[1]);
  const count      = parseInt(args[2]);
  const dictMatch  = args[3].match(/^'(.+)'\.split/);
  if (!dictMatch) return null;
  const dict = dictMatch[1].split('|');

  let result = packedStr;
  for (let i = 0; i < Math.min(count, dict.length); i++) {
    if (dict[i]) {
      result = result.replace(new RegExp('\\b' + i.toString(radix) + '\\b', 'g'), dict[i]);
    }
  }
  return result;
}

// ─── Plain axios fetch (no browser) ──────────────────────────────────────────
async function plainFetch(url, extraHeaders = {}) {
  const { data, status } = await axios.get(url, {
    timeout: PLAIN_TIMEOUT,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': config.baseurl + '/',
      'Origin': config.baseurl,
      ...extraHeaders,
    },
    validateStatus: s => s < 600,
  });
  return { data, status };
}

function isCfBlocked(status, html) {
  if (status === 403 || status === 503) return true;
  if (typeof html === 'string') {
    if (html.includes('Just a moment') || html.includes('cf-browser-verification')) return true;
    if (html.includes('Checking your browser') || html.includes('DDoS protection')) return true;
  }
  return false;
}

// ─── Puppeteer page fetch ─────────────────────────────────────────────────────
async function puppeteerFetch(url) {
  const page = await acquirePage();
  if (!page) throw new Error('[cfBypass] No browser available — install puppeteer or puppeteer-core');

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PUPPET_TIMEOUT });

    // Wait for CF challenge to clear
    await page.waitForFunction(
      () => !document.title.includes('Just a moment') &&
            !document.querySelector('#cf-challenge-wrapper'),
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch an HTML page from hianime.ad.
 * Tries plain axios first; falls back to Puppeteer if CF blocks.
 *
 * @param {string} endpoint  e.g. '/home', '/watch/naruto-355?ep=1000'
 * @returns {Promise<string>} HTML string
 */
export async function cfFetch(endpoint) {
  const url = config.baseurl + endpoint;

  // 1) Try plain fetch
  try {
    const { data, status } = await plainFetch(url);
    if (!isCfBlocked(status, data)) {
      console.log(`[cfBypass] Plain fetch OK: ${endpoint}`);
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
    console.warn(`[cfBypass] Plain fetch blocked (${status}), switching to Puppeteer: ${endpoint}`);
  } catch (err) {
    console.warn(`[cfBypass] Plain fetch error (${err.message}), trying Puppeteer: ${endpoint}`);
  }

  // 2) Puppeteer fallback
  console.log(`[cfBypass] Puppeteer fetch: ${url}`);
  return puppeteerFetch(url);
}

/**
 * Fetch a JSON AJAX endpoint from hianime.ad.
 * These endpoints need X-Requested-With header and return JSON.
 *
 * @param {string} ajaxPath  e.g. '/ajax/v2/episode/servers?episodeId=123'
 * @param {string} referer   e.g. '/watch/naruto-355?ep=1000'
 * @returns {Promise<object>} Parsed JSON
 */
export async function cfFetchAjax(ajaxPath, referer = '/') {
  const url = config.baseurl + ajaxPath;
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Referer': config.baseurl + referer,
    'Origin': config.baseurl,
  };

  // 1) Try plain axios (AJAX endpoints usually pass CF with right headers)
  try {
    const { data, status } = await plainFetch(url, headers);
    if (!isCfBlocked(status, typeof data === 'string' ? data : '')) {
      console.log(`[cfBypass] AJAX plain OK: ${ajaxPath}`);
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
    console.warn(`[cfBypass] AJAX blocked (${status}), trying Puppeteer for: ${ajaxPath}`);
  } catch (err) {
    console.warn(`[cfBypass] AJAX plain error (${err.message}), trying Puppeteer: ${ajaxPath}`);
  }

  // 2) Puppeteer: navigate to Referer page first to get CF cookies, then XHR
  const page = await acquirePage();
  if (!page) throw new Error('[cfBypass] No browser for AJAX — install puppeteer or puppeteer-core');

  try {
    // Load the watch page first so CF sets cookies on the browser
    const refererUrl = config.baseurl + referer;
    await page.goto(refererUrl, { waitUntil: 'networkidle2', timeout: PUPPET_TIMEOUT });
    await page.waitForFunction(
      () => !document.title.includes('Just a moment'),
      { timeout: PUPPET_TIMEOUT }
    ).catch(() => {});

    // Now do the AJAX call inside the browser context (CF cookies already set)
    const result = await page.evaluate(async (ajaxUrl, hdrs) => {
      const res = await fetch(ajaxUrl, { headers: hdrs, credentials: 'include' });
      return res.text();
    }, url, headers);

    await releasePage(page);
    return JSON.parse(result);
  } catch (err) {
    await releasePage(page);
    throw err;
  }
}

/**
 * Resolve an embed URL to get its HLS m3u8 stream.
 * Uses Puppeteer to intercept network requests for .m3u8 URLs.
 * Also tries plain packed-JS unpacking first (faster).
 *
 * @param {string} embedUrl  full embed URL
 * @returns {Promise<{master_m3u8: string|null, subtitle: string|null, variants: Array}>}
 */
export async function resolveEmbedStream(embedUrl) {
  // 1) Try plain axios + packed JS unpack
  try {
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });

    // Direct src= pattern
    const srcMatch = html.match(/const src\s*=\s*"(https?:\/\/[^"]+?\/master\.m3u8[^"]*)"/);
    if (srcMatch) {
      return parseMasterM3u8(srcMatch[1], embedUrl);
    }

    // Packed JS
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

  // 2) Puppeteer: intercept the m3u8 request
  const page = await acquirePage();
  if (!page) {
    return { embed_url: embedUrl, master_m3u8: null, subtitle: null, variants: [],
             note: 'No browser available (install puppeteer or puppeteer-core)' };
  }

  try {
    let m3u8Url = null;
    await page.setRequestInterception(true);

    page.on('request', req => {
      const u = req.url();
      if ((u.includes('.m3u8') || /\/[^/]+_o\/[^/]+\.txt$/.test(u)) && !m3u8Url) {
        m3u8Url = u.split('?')[0];
      }
      req.continue().catch(() => {});
    });

    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: PUPPET_TIMEOUT });

    await releasePage(page);

    if (m3u8Url) return parseMasterM3u8(m3u8Url, embedUrl);

    return { embed_url: embedUrl, master_m3u8: null, subtitle: null, variants: [],
             note: 'No HLS stream found' };
  } catch (err) {
    await releasePage(page);
    return { embed_url: embedUrl, master_m3u8: null, subtitle: null, variants: [],
             error: err.message };
  }
}

async function parseMasterM3u8(masterUrl, embedUrl) {
  const { data: m3u8 } = await axios.get(masterUrl, {
    headers: { 'User-Agent': UA, Referer: new URL(embedUrl).origin },
    timeout: 10000,
  });

  const base     = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
  const variants = [];
  const lines    = m3u8.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const res  = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1]   || 'unknown';
    const bw   = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0');
    const name = lines[i].match(/NAME="([^"]+)"/)?.[1]           || res;
    if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
      const pl = lines[i + 1].trim();
      variants.push({
        name, resolution: res,
        bandwidth_kbps: Math.round(bw / 1000),
        url: pl.startsWith('http') ? pl : base + pl,
      });
    }
  }
  variants.sort((a, b) => b.bandwidth_kbps - a.bandwidth_kbps);
  return { master_m3u8: masterUrl, subtitle: null, variants };
}

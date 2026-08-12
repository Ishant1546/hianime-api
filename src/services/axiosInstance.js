/**
 * axiosInstance.js
 * Central HTML page fetcher for hianime.ad.
 * Uses cfBypass (Puppeteer) to handle Cloudflare protection automatically.
 */

import { cfFetch } from './cfBypass.js';

export const axiosInstance = async (endpoint) => {
  try {
    console.log(`[axiosInstance] Fetching: ${endpoint}`);
    const data = await cfFetch(endpoint);

    if (!data || data.length === 0) {
      return { success: false, message: 'Empty response received' };
    }

    console.log(`[axiosInstance] Success: ${endpoint} (${data.length} bytes)`);
    return { success: true, data };
  } catch (error) {
    console.error(`[axiosInstance] Failed: ${endpoint} —`, error.message);
    return { success: false, message: error.message || 'Unknown error occurred' };
  }
};

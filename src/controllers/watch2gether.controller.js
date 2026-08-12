import { validationError } from '../utils/errors.js';
import { cfFetchAjax, cfFetch } from '../services/cfBypass.js';
import { extractWatch2gether } from '../extractor/extractWatch2gether.js';
import { withCache } from '../utils/redis.js';
import { load } from 'cheerio';

const VALID_ROOM_FILTERS = ['all', 'on_air', 'scheduled', 'waiting', 'ended'];

const watch2getherController = async (c) => {
  const room = c.req.query('room') || 'all';
  if (!VALID_ROOM_FILTERS.includes(room))
    throw new validationError(`Invalid room filter. Must be one of: ${VALID_ROOM_FILTERS.join(', ')}`);

  return await withCache(`watch2gether-${room}`, async () => {
    // Try AJAX
    try {
      const data = await cfFetchAjax(`/ajax/watch2gether/list?room=${room}`, '/watch2gether');
      if (data?.html) return extractWatch2gether(data.html);
      if (data?.status === false) return { rooms: [], total: 0, note: 'No watch2gether rooms available' };
    } catch (err) {
      console.warn('[watch2gether] AJAX failed:', err.message);
    }

    // Try scraping watch2gether page directly
    try {
      const html = await cfFetch('/watch2gether');
      const $ = load(html);
      const hasFeature = $('.live-item, .watch2gether-item, #watch2gether').length > 0;
      if (!hasFeature) return { rooms: [], total: 0, note: 'Watch2gether feature not available on this site' };
      return extractWatch2gether(html);
    } catch {}

    return { rooms: [], total: 0, note: 'Watch2gether unavailable' };
  }, 60 * 5);
};

export default watch2getherController;

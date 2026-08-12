import { validationError } from '../utils/errors.js';
import { cfFetch } from '../services/cfBypass.js';
import { load } from 'cheerio';

// hianime.ad embeds servers directly in the watch page HTML
// id format: "steinsgate-3::ep=213" OR "steinsgate-3?ep=213"
const parseId = (id) => {
  // normalize :: to ?
  const normalized = id.replace('::', '?');
  const slugMatch = normalized.match(/^([^?]+)/);
  const epMatch = normalized.match(/ep=(\d+)/);
  return {
    slug: slugMatch?.[1] || null,
    episode: epMatch?.[1] || '1',
  };
};

export const getServers = async (id) => {
  const { slug, episode } = parseId(id);
  if (!slug) throw new validationError('Invalid id format. Use: anime-slug::ep=123');

  // Scrape watch page directly — hianime.ad has servers inline
  const html = await cfFetch(`/watch/${slug}/ep-${episode}`);
  const $ = load(html);

  const extractList = (selector, type) => {
    const servers = [];
    $(selector).find('[data-video]').each((i, el) => {
      const videoUrl = $(el).attr('data-video') || '';
      const name = $(el).text().trim() || `HD-${i + 1}`;
      let embedUrl = videoUrl;
      let subtitle = null;
      // Parse subtitle param if present
      try {
        const u = new URL(videoUrl.startsWith('http') ? videoUrl : 'https://hianime.ad' + videoUrl);
        subtitle = u.searchParams.get('sub_1') || u.searchParams.get('caption_1') || null;
        embedUrl = u.origin + u.pathname;
      } catch {}
      servers.push({ index: i + 1, type, name, embedUrl, subtitle });
    });
    // Fallback: old .server-item[data-id] format
    if (servers.length === 0) {
      $(selector).find('.server-item').each((i, el) => {
        const serverId = $(el).attr('data-id');
        const name = $(el).find('a').text().trim();
        const serverIdx = Number($(el).attr('data-server-id')) || i + 1;
        if (serverId || name) {
          servers.push({ index: serverIdx, type, name, id: serverId, embedUrl: null });
        }
      });
    }
    return servers;
  };

  const sub = extractList('.ps__-list.server-items[data-id="sub"], .servers-sub .ps__-list', 'sub');
  const dub = extractList('.ps__-list.server-items[data-id="dub"], .servers-dub .ps__-list', 'dub');
  const raw = extractList('.ps__-list.server-items[data-id="raw"], .servers-raw .ps__-list', 'raw');

  // Fallback: parse any .ps__-list with data-id attribute
  let finalSub = sub, finalDub = dub;
  if (sub.length === 0 && dub.length === 0) {
    $('.ps__-list.server-items').each((_, el) => {
      const t = $(el).attr('data-id')?.toLowerCase() || 'sub';
      const list = [];
      $(el).find('[data-video]').each((i, item) => {
        const videoUrl = $(item).attr('data-video') || '';
        const name = $(item).text().trim() || `HD-${i + 1}`;
        list.push({ index: i + 1, type: t, name, embedUrl: videoUrl, subtitle: null });
      });
      if (t === 'sub') finalSub = list;
      else if (t === 'dub') finalDub = list;
    });
  }

  return {
    episode: Number(episode),
    sub: finalSub,
    dub: finalDub,
    raw,
  };
};

const serversController = async (c) => {
  const id = c.req.query('id');
  if (!id) throw new validationError('id is required. Example: ?id=steinsgate-3::ep=213');
  return getServers(id);
};

export default serversController;

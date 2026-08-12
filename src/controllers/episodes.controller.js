import { validationError } from '../utils/errors.js';
import { cfFetch } from '../services/cfBypass.js';
import { load } from 'cheerio';

const episodesController = async (c) => {
  const id = c.req.param('id');
  if (!id) throw new validationError('id is required');

  try {
    // hianime.ad: episodes list is embedded in /watch/{slug}/ep-1 page
    const html = await cfFetch(`/watch/${id}/ep-1`);
    const $ = load(html);

    const episodes = [];
    $('.ssl-item.ep-item').each((i, el) => {
      const href = $(el).attr('href') || '';
      const epNum = parseInt($(el).attr('data-num'), 10) || i + 1;
      const title = $(el).attr('title') || $(el).find('.ep-name').text().trim() || `Episode ${epNum}`;
      const altTitle = $(el).find('.ep-name.e-dynamic-name').attr('data-jname') || null;
      const isFiller = $(el).hasClass('ssl-item-filler');
      // id format: anime-slug::ep=123
      const epId = href.replace('/watch/', '').replace('?', '::');

      if (epNum && href) {
        episodes.push({
          episodeNumber: epNum,
          title,
          alternativeTitle: altTitle,
          id: epId,
          isFiller,
        });
      }
    });

    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

    return { totalEpisodes: episodes.length, episodes };
  } catch (err) {
    console.error('[episodesController]', err.message);
    throw new validationError('make sure the id is correct. Example: /episodes/one-piece-100', { id });
  }
};

export default episodesController;

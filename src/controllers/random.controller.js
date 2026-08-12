import { cfFetch } from '../services/cfBypass.js';
import { validationError } from '../utils/errors.js';
import { load } from 'cheerio';

const randomController = async () => {
  const html = await cfFetch('/home');
  const $ = load(html);

  const ids = [];
  // Collect from multiple sections for variety
  $('.flw-item .film-detail .film-name .dynamic-name').each((_, el) => {
    const href = $(el).attr('href') || '';
    const id = href.split('/').pop()?.split('?')[0];
    if (id) ids.push(id);
  });

  // Also from spotlight
  $('.deslide-wrap .desi-buttons a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const id = href.split('/').pop()?.split('?')[0];
    if (id && !ids.includes(id)) ids.push(id);
  });

  if (ids.length === 0) throw new validationError('No anime found on homepage');

  const randomId = ids[Math.floor(Math.random() * ids.length)];
  return { id: randomId };
};

export default randomController;

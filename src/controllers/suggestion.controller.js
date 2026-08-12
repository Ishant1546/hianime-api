import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { load } from 'cheerio';

const extractSuggestions = (html) => {
  const $ = load(html);
  const results = [];

  // Try multiple selectors
  const items = $('.nav-item, .suggestion-item, .search-suggest-item').toArray();
  const filtered = items.filter((_, i) => i < items.length - 2); // remove last 2 nav items

  (filtered.length ? filtered : items).forEach(el => {
    const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
    const id = href.split('/').pop()?.split('?')[0];
    const poster = $(el).find('.film-poster-img').attr('data-src')
                || $(el).find('img').attr('data-src')
                || $(el).find('img').attr('src')
                || null;
    const titleEl = $(el).find('.film-name, .dynamic-name, .title');
    const title = titleEl.text().trim() || null;
    const altTitle = titleEl.attr('data-jname') || null;
    const infoEl = $(el).find('.film-infor, .info');
    const aired = infoEl.find('span').first().text().trim() || null;
    const duration = infoEl.find('span').last().text().trim() || null;

    if (id && title) results.push({ id, title, alternativeTitle: altTitle, poster, aired, duration });
  });

  return results;
};

const suggestionController = async (c) => {
  const keyword = c.req.query('keyword');
  if (!keyword) throw new validationError('keyword is required');

  const q = keyword.trim().toLowerCase().replace(/\s+/g, '+');

  try {
    const data = await cfFetchAjax(`/ajax/search/suggest?keyword=${q}`, '/home');
    if (!data?.status && !data?.html) throw new validationError('No suggestions found');
    const results = extractSuggestions(data.html || '');
    return { keyword, results, total: results.length };
  } catch (err) {
    console.error('[suggestion]', err.message);
    throw new validationError('Suggestion fetch failed: ' + err.message);
  }
};

export default suggestionController;

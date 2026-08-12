import { load } from 'cheerio';

const extractSchedule = (html) => {
  if (!html) return [];
  const $ = load(html);
  const response = [];

  $('li, a').each((_, el) => {
    const $el = $(el);
    const href = $el.is('a') ? $el.attr('href') : $el.find('a').attr('href');
    if (!href || href === '#' || !href.startsWith('/')) return;

    const id = href.replace(/^\//, '');
    const time = $el.find('.time, .anis-scheduled-time').text().trim() || null;
    const titleEl = $el.find('.film-name, .dynamic-name, .name');
    const title = titleEl.text().trim() || null;
    const altTitle = titleEl.attr('data-jname')?.trim() || null;
    const epText = $el.find('.btn-play, .ep-item').text().trim();
    const epMatch = epText.match(/\d+/);
    const episode = epMatch ? Number(epMatch[0]) : null;

    if (title && id) {
      response.push({ id, time, title, alternativeTitle: altTitle, episode });
    }
  });

  return response;
};

export default extractSchedule;

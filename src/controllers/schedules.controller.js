import { validationError } from '../utils/errors.js';
import { cfFetchAjax, cfFetch } from '../services/cfBypass.js';
import extractSchedule from '../extractor/extractSchedule.js';
import { load } from 'cheerio';

async function fetchScheduleForDate(date) {
  // Try AJAX first
  try {
    const data = await cfFetchAjax(`/ajax/schedule/list?tzOffset=-330&date=${date}`, '/home');
    if (data?.html) return extractSchedule(data.html);
  } catch {}

  // Fallback: scrape /schedule page
  try {
    const html = await cfFetch(`/schedule?date=${date}`);
    const $ = load(html);
    const scheduleHtml = $('.schedule-list, .anis-schedule').html() || '';
    if (scheduleHtml) return extractSchedule(scheduleHtml);
    // parse full page
    return extractSchedule(html);
  } catch {}

  return [];
}

async function schedulesController(c) {
  const dateParam = c.req.query('date');
  const startDate = dateParam
    ? (() => {
        const [y, m, d] = dateParam.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        if (isNaN(dt.getTime())) throw new validationError('Invalid date. Use YYYY-MM-DD');
        return dt;
      })()
    : new Date();

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  const results = await Promise.allSettled(dates.map(date =>
    fetchScheduleForDate(date).then(shows => ({ date, shows }))
  ));

  const response = {};
  results.forEach((r, i) => {
    response[dates[i]] = r.status === 'fulfilled' ? r.value.shows || r.value : [];
  });

  return { success: true, data: response };
}

export default schedulesController;

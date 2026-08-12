import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import extractSchedule from '../extractor/extractSchedule.js';

async function schedulesController(c) {
  const today = new Date();
  const dateParam = c.req.query('date');

  let startDate = today;
  if (dateParam) {
    const [year, month, day] = dateParam.split('-').map(Number);
    startDate = new Date(year, month - 1, day);
    if (isNaN(startDate.getTime()))
      throw new validationError('Invalid date format. Use YYYY-MM-DD');
  }

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }

  try {
    const results = await Promise.all(dates.map(async (date) => {
      try {
        const data = await cfFetchAjax(`/ajax/schedule/list?tzOffset=-330&date=${date}`, '/home');
        return { date, shows: extractSchedule(data.html) };
      } catch (err) {
        console.error(`Schedule fetch failed for ${date}:`, err.message);
        return { date, shows: [], error: 'Failed to fetch' };
      }
    }));

    const response = {};
    results.forEach(r => { response[r.date] = r.shows; });
    return { success: true, data: response };
  } catch (error) {
    throw new validationError('Failed to fetch schedules');
  }
}

export default schedulesController;

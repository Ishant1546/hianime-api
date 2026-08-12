import { load } from 'cheerio';

const extractNextEpisodeSchadule = (html) => {
  const $ = load(html);
  // Multiple possible selectors
  const time =
    $('.schedule-alert #schedule-date').attr('data-value') ||
    $('.anis-schedule-date').attr('data-value') ||
    $('[data-schedule-date]').attr('data-schedule-date') ||
    $('[data-next-episode]').attr('data-next-episode') ||
    null;
  return { time };
};

export default extractNextEpisodeSchadule;

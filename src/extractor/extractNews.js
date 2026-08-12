import * as cheerio from 'cheerio';

export const extractNews = (html) => {
  const $ = cheerio.load(html);
  const news = [];

  // Try multiple possible selectors
  const containers = [
    '.zr-news-list .item',
    '.news-list .item',
    '.news-feed .item',
    'article.news-item',
    '.blog-list .item',
  ];

  let found = false;
  for (const sel of containers) {
    if ($(sel).length > 0) {
      $(sel).each((_, el) => {
        const linkEl = $(el).find('a').first();
        const link = linkEl.attr('href') || $(el).find('.zrn-title, .news-title').attr('href') || null;
        const id = link?.split('/').pop() || null;
        const title = $(el).find('.news-title, .zrn-title, h3, h2').text().trim() || linkEl.attr('title') || null;
        const desc = $(el).find('.description, .excerpt, p').text().trim() || null;
        const thumb = $(el).find('img').attr('src') || $(el).find('.zrn-image').attr('src') || null;
        const time = $(el).find('.time-posted, .time, time').text().trim() || null;
        if (title) news.push({ id, title, description: desc, thumbnail: thumb, uploadedAt: time, url: link });
      });
      found = true;
      break;
    }
  }

  // Fallback: generic article/post items
  if (!found) {
    $('article, .post-item, .news-card').each((_, el) => {
      const link = $(el).find('a').attr('href') || null;
      const title = $(el).find('h1,h2,h3').first().text().trim() || null;
      const thumb = $(el).find('img').attr('src') || null;
      if (title) news.push({ id: link?.split('/').pop(), title, description: null, thumbnail: thumb, uploadedAt: null, url: link });
    });
  }

  return { news, total: news.length };
};

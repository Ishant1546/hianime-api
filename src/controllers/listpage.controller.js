import { extractListPage } from '../extractor/extractListpage.js';
import { cfFetch } from '../services/cfBypass.js';
import { NotFoundError, validationError } from '../utils/errors.js';

const VALID_QUERIES = [
  'top-airing','most-popular','most-favorite','completed',
  'recently-added','recently-updated','top-upcoming',
  'genre','producer','az-list',
  'subbed-anime','dubbed-anime',
  'movie','tv','ova','ona','special','events',
];

const listpageController = async (c) => {
  const query = (c.req.param('query') || '').toLowerCase();
  if (!VALID_QUERIES.includes(query))
    throw new validationError('invalid query', { validateQueries: VALID_QUERIES });

  let category = c.req.param('category') || null;
  const page = c.req.query('page') || 1;

  if ((query === 'genre' || query === 'producer') && !category)
    throw new validationError(`category is required for query: ${query}`);

  if (!['genre','producer','az-list'].includes(query)) category = null;

  let normalizedCat = category?.replaceAll(' ', '-').toLowerCase();
  if (normalizedCat === 'martial-arts') normalizedCat = 'marial-arts';

  // Try multiple URL patterns for hianime.ad
  const urlsToTry = [];
  const base = category ? `/${query}/${normalizedCat}` : `/${query}`;
  urlsToTry.push(`${base}?page=${page}`);
  // Some categories may be under /anime/ prefix
  if (!['genre','producer','az-list'].includes(query)) {
    urlsToTry.push(`/anime/${query}?page=${page}`);
  }

  let lastErr = null;
  for (const url of urlsToTry) {
    try {
      const html = await cfFetch(url);
      const response = extractListPage(html);
      if (response.response.length > 0) return response;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }

  throw new NotFoundError('No results found for: ' + query);
};

export default listpageController;

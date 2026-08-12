import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { extractSuggestions } from '../extractor/extractSuggestions.js';

const suggestionController = async (c) => {
  const keyword = c.req.query('keyword') || null;
  if (!keyword) throw new validationError('query is required');

  const noSpaceKeyword = keyword.trim().toLowerCase().replace(/\s+/g, '+');
  const ajaxPath = `/ajax/search/suggest?keyword=${noSpaceKeyword}`;

  try {
    const data = await cfFetchAjax(ajaxPath, '/home');
    if (!data.status) throw new validationError('suggestion not found');
    return extractSuggestions(data.html);
  } catch (err) {
    console.error('[suggestionController]', err.message);
    throw new validationError('suggestion not found');
  }
};

export default suggestionController;

import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { extractCharacters } from '../extractor/extractCharacters.js';

const charactersController = async (c) => {
  const id = c.req.param('id');
  const page = c.req.query('page') || 1;
  if (!id) throw new validationError('id is required');

  const idNum = id.split('-').pop();
  const ajaxPath = `/ajax/character/list/${idNum}?page=${page}`;

  try {
    const data = await cfFetchAjax(ajaxPath, '/home');
    return extractCharacters(data.html);
  } catch (err) {
    console.error('[charactersController]', err.message);
    throw new validationError('characters not found');
  }
};

export default charactersController;

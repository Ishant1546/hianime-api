import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { extractEpisodes } from '../extractor/extractEpisodes.js';

const episodesController = async (c) => {
  const id = c.req.param('id');
  if (!id) throw new validationError('id is required');

  const idNum    = id.split('-').at(-1);
  const ajaxPath = `/ajax/v2/episode/list/${idNum}`;
  const referer  = `/watch/${id}`;

  try {
    const data = await cfFetchAjax(ajaxPath, referer);
    return extractEpisodes(data.html);
  } catch (err) {
    console.error('[episodesController]', err.message);
    throw new validationError('make sure the id is correct', { validIdEX: 'one-piece-100' });
  }
};

export default episodesController;

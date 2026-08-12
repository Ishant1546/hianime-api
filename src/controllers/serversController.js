import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { extractServers } from '../extractor/extractServers.js';

export const getServers = async (id) => {
  const episode  = id.split('ep=').at(-1);
  const ajaxPath = `/ajax/v2/episode/servers?episodeId=${episode}`;
  const referer  = `/watch/${id.replace('::', '?')}`;

  try {
    const data = await cfFetchAjax(ajaxPath, referer);
    return extractServers(data.html);
  } catch (err) {
    console.error('[serversController]', err.message);
    throw new validationError('make sure given endpoint is correct', {
      validIdEx: 'watch/steinsgate-3?ep=213',
    });
  }
};

const serversController = async (c) => {
  const id = c.req.query('id');
  if (!id) throw new validationError('id is required');
  return getServers(id);
};

export default serversController;

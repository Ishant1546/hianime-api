import { validationError } from '../utils/errors.js';
import { cfFetchAjax } from '../services/cfBypass.js';
import { extractWatch2gether } from '../extractor/extractWatch2gether.js';
import { withCache } from '../utils/redis.js';

const VALID_ROOM_FILTERS = ['all', 'on_air', 'scheduled', 'waiting', 'ended'];

const watch2getherController = async (c) => {
  const room = c.req.query('room') || 'all';
  if (!VALID_ROOM_FILTERS.includes(room))
    throw new validationError(`Invalid room filter. Must be one of: ${VALID_ROOM_FILTERS.join(', ')}`);

  return await withCache(`watch2gether-${room}`, async () => {
    try {
      const data = await cfFetchAjax(`/ajax/watch2gether/list?room=${room}`, '/watch2gether');
      if (!data || !data.status) throw new validationError('Failed to fetch watch2gether data');
      return extractWatch2gether(data.html);
    } catch (error) {
      throw new validationError(error.message);
    }
  }, 60 * 5);
};

export default watch2getherController;

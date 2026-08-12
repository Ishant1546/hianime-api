import { validationError } from '../utils/errors.js';
import { getServers } from './serversController.js';
import { resolveEmbedStream } from '../services/cfBypass.js';
import axios from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const streamController = async (c) => {
  let { id, server = 'HD-1', type = 'sub' } = c.req.query();
  if (!id) throw new validationError('id is required');

  server = server.toUpperCase();
  const servers = await getServers(id);

  const pool = servers[type] || servers['sub'] || [];
  let selected = pool.find(s => s.name.toUpperCase() === server)
               || pool.find(s => s.name.toUpperCase().includes(server))
               || pool[0];

  if (!selected) throw new validationError('server not found', { available: pool.map(s => s.name) });

  // hianime.ad: use embedUrl directly
  if (selected.embedUrl) {
    const stream = await resolveEmbedStream(selected.embedUrl);
    return {
      id,
      type,
      server: selected.name,
      embedUrl: selected.embedUrl,
      subtitle: selected.subtitle || stream.subtitle || null,
      ...stream,
    };
  }

  // Fallback: HD-4 megaplay
  if (selected.name === 'HD-4') {
    const epId = id.split('ep=').pop();
    return { streamingLink: `https://megaplay.buzz/stream/s-2/${epId}/${type}`, server: 'HD-4' };
  }

  throw new validationError('Could not resolve stream for this server');
};

export default streamController;

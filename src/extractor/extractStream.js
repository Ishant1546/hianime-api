import { resolveEmbedStream } from '../services/cfBypass.js';
import { getServers } from '../controllers/serversController.js';

export const extractStream = async ({ selectedServer, id }) => {
  // HD-4 fallback
  if (selectedServer.name === 'HD-4') {
    const epId = id.split('ep=').pop();
    return { streamingLink: `https://megaplay.buzz/stream/s-2/${epId}/${selectedServer.type}`, server: 'HD-4' };
  }

  // hianime.ad: server has embedUrl directly
  if (selectedServer.embedUrl) {
    const stream = await resolveEmbedStream(selectedServer.embedUrl);
    return {
      id,
      type: selectedServer.type,
      server: selectedServer.name,
      embedUrl: selectedServer.embedUrl,
      subtitle: selectedServer.subtitle || stream.subtitle || null,
      ...stream,
    };
  }

  throw new Error('No embed URL available for server: ' + selectedServer.name);
};

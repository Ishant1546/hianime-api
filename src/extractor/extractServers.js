import { load } from 'cheerio';

export const extractServers = (html) => {
  const $ = load(html);

  const episode = $('.server-notice strong b').text().trim().split(' ').at(-1);

  const extractServerList = (block, type) => {
    const servers = [];

    // Primary format: hianime.vc / standard AJAX — uses .server-item[data-id]
    $(block)
      .find('.server-item')
      .each((i, element) => {
        const serverType = $(element).attr('data-type') || type;
        const serverId = $(element).attr('data-id');
        const serverName = $(element).find('a').text().trim();
        const serverIndex = $(element).attr('data-server-id');
        if (serverId || serverName) {
          servers.push({
            index: Number(serverIndex) || i + 1,
            type: serverType,
            id: serverId,
            name: serverName,
          });
        }
      });

    // Fallback format: hianime.ad — uses [data-video] attribute inline
    if (servers.length === 0) {
      $(block)
        .find('[data-video]')
        .each((i, element) => {
          const videoUrl = $(element).attr('data-video') || '';
          const serverName = $(element).text().trim() || `HD-${i + 1}`;
          // Extract a pseudo-id from the URL for megacloud compatibility
          const idMatch = videoUrl.match(/\/([a-zA-Z0-9]+)\??/);
          const serverId = idMatch ? idMatch[1] : null;
          servers.push({
            index: i + 1,
            type,
            id: serverId,
            name: serverName,
            embedUrl: videoUrl, // keep raw embed URL for direct use
          });
        });
    }

    // Always add HD-4 fallback at end
    servers.push({
      index: null,
      type: block.includes('sub') ? 'sub' : type,
      id: null,
      name: 'HD-4',
    });

    return servers;
  };

  const subServers = extractServerList('.servers-sub .ps__-list', 'sub');
  const dubServers = extractServerList('.servers-dub .ps__-list', 'dub');

  return {
    episode: Number(episode),
    sub: subServers,
    dub: dubServers,
  };
};

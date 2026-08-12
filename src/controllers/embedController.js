import { getServers } from './serversController.js';
import { resolveEmbedStream } from '../services/cfBypass.js';

const embedController = async (c) => {
  try {
    let id     = c.req.param('id')     || c.req.query('id');
    let server = c.req.param('server') || c.req.query('server');
    let type   = c.req.param('type')   || c.req.query('type');

    if (!id) return c.text('id is required', 400);
    server = (server || 'HD-1').toUpperCase();
    type   = type || 'sub';

    const servers = await getServers(id);
    const pool = servers[type] || servers['sub'] || [];

    let selected = null;
    if (server.startsWith('S-')) {
      const idx = parseInt(server.replace('S-', ''));
      selected = pool.find(s => s.index === idx);
    }
    selected = selected
      || pool.find(s => s.name.toUpperCase() === server)
      || pool.find(s => s.name.toUpperCase().includes('HD-1'))
      || pool[0];

    if (!selected || !selected.embedUrl) {
      return c.text(`Server ${server} not found or has no embed URL`, 404);
    }

    const stream = await resolveEmbedStream(selected.embedUrl);
    if (!stream || !stream.master_m3u8) {
      return c.text('Failed to extract stream', 500);
    }

    const m3u8Url  = stream.master_m3u8;
    const tracks   = stream.variants || [];
    const subtitle = selected.subtitle || stream.subtitle || null;
    const intro    = { start: 0, end: 0 };
    const outro    = { start: 0, end: 0 };

    const html = buildPlayerHtml(m3u8Url, tracks, subtitle, intro, outro, type);
    return c.html(html);
  } catch (err) {
    console.error('[embedController]', err.message);
    return c.text('Internal Server Error: ' + err.message, 500);
  }
};

function buildPlayerHtml(m3u8Url, variants, subtitle, intro, outro, episodeType) {
  const tracks = subtitle ? [{ file: subtitle, label: 'English', kind: 'subtitles' }] : [];
  return `<!DOCTYPE html>
<html>
<head>
  <title>Player</title>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body,html{width:100%;height:100%;background:#000;overflow:hidden}
    video{width:100%;height:100%;display:block}
    .controls{position:absolute;bottom:0;left:0;right:0;padding:8px 12px;background:linear-gradient(transparent,rgba(0,0,0,.8));display:flex;align-items:center;gap:8px}
    button{background:rgba(255,255,255,.15);border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px}
    button:hover{background:rgba(255,255,255,.3)}
    select{background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.3);color:#fff;padding:4px 8px;border-radius:4px;font-size:13px}
    .skip{position:absolute;bottom:60px;right:16px;display:none}
    .skip.show{display:block}
    #loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
    .spinner{width:48px;height:48px;border:4px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <video id="v" crossorigin="anonymous" playsinline autoplay></video>
  <div id="loader"><div class="spinner"></div></div>
  <div class="skip" id="si"><button onclick="skipIntro()">Skip Intro ▶</button></div>
  <div class="skip" id="so"><button onclick="skipOutro()">Skip Outro ▶</button></div>
  <div class="controls">
    <button onclick="v.paused?v.play():v.pause()" id="pb">▶</button>
    <input type="range" id="seek" min="0" max="100" value="0" style="flex:1" oninput="v.currentTime=this.value/100*v.duration">
    <select id="qs" onchange="setQuality(this.value)"><option value="-1">Auto</option></select>
    <select id="ss" onchange="setSub(this.value)"><option value="-1">Off</option></select>
    <button onclick="v.requestFullscreen()">⛶</button>
  </div>
<script>
const v=document.getElementById('v');
const loader=document.getElementById('loader');
const intro=${JSON.stringify(intro)};
const outro=${JSON.stringify(outro)};
const subtitles=${JSON.stringify(tracks)};
let hls,curSub=-1;

v.addEventListener('playing',()=>loader.style.display='none');
v.addEventListener('waiting',()=>loader.style.display='flex');
v.addEventListener('play',()=>document.getElementById('pb').textContent='⏸');
v.addEventListener('pause',()=>document.getElementById('pb').textContent='▶');
v.addEventListener('timeupdate',()=>{
  const t=v.currentTime;
  document.getElementById('seek').value=v.duration?t/v.duration*100:0;
  document.getElementById('si').className='skip'+(intro.end>0&&t>=intro.start&&t<intro.end?' show':'');
  document.getElementById('so').className='skip'+(outro.end>0&&t>=outro.start&&t<outro.end?' show':'');
});

if(Hls.isSupported()){
  hls=new Hls({startLevel:-1});
  hls.loadSource('${m3u8Url}');
  hls.attachMedia(v);
  hls.on(Hls.Events.MANIFEST_PARSED,(_,d)=>{
    const qs=document.getElementById('qs');
    d.levels.forEach((l,i)=>{const o=document.createElement('option');o.value=i;o.text=l.height+'p';qs.appendChild(o);});
    loadSubs();
  });
  hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)hls.recoverMediaError();});
}else if(v.canPlayType('application/vnd.apple.mpegurl')){
  v.src='${m3u8Url}';
  v.addEventListener('loadedmetadata',loadSubs);
}

function loadSubs(){
  const ss=document.getElementById('ss');
  subtitles.forEach((t,i)=>{
    const o=document.createElement('option');o.value=i;o.text=t.label||'Sub '+i;ss.appendChild(o);
    const el=document.createElement('track');
    el.kind='subtitles';el.src=t.file;el.srclang='en';el.label=t.label||'Sub';
    v.appendChild(el);
  });
  Array.from(v.textTracks).forEach(t=>t.mode='disabled');
}

function setQuality(val){if(hls)hls.currentLevel=parseInt(val);}
function setSub(val){
  curSub=parseInt(val);
  Array.from(v.textTracks).forEach((t,i)=>t.mode=i===curSub?'showing':'disabled');
}
function skipIntro(){v.currentTime=intro.end;}
function skipOutro(){v.currentTime=outro.end;}
</script>
</body>
</html>`;
}

export default embedController;

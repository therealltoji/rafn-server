const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

const CONSUMET = 'https://api.consumet.org';

async function get(url) {
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function findId(title) {
  let d = await get(`${CONSUMET}/anime/gogoanime/${encodeURIComponent(title)}`);
  if (d?.results?.length) return d.results[0].id;

  const short = title.split(':')[0].trim();
  d = await get(`${CONSUMET}/anime/gogoanime/${encodeURIComponent(short)}`);
  if (d?.results?.length) return d.results[0].id;

  return null;
}

async function getStream(animeId, ep) {
  const tries = [`${animeId}-episode-${ep}`, `${animeId}-dub-episode-${ep}`];
  for (const epId of tries) {
    const d = await get(`${CONSUMET}/anime/gogoanime/watch/${epId}`);
    if (d?.sources?.length) {
      const src =
        d.sources.find(s => s.quality === '1080p') ||
        d.sources.find(s => s.quality === '720p')  ||
        d.sources.find(s => s.quality === 'default') ||
        d.sources[0];
      return { url: src.url, quality: src.quality, source: 'Gogoanime' };
    }
  }
  return null;
}

app.get('/api/auto', async (req, res) => {
  const { title, ep = 1 } = req.query;
  if (!title) return res.status(400).json({ url: null, error: 'title required' });

  const animeId = await findId(title);
  if (!animeId) return res.json({ url: null, error: 'الأنمي مو موجود' });

  const stream = await getStream(animeId, ep);
  if (!stream) return res.json({ url: null, error: 'الحلقة مو موجودة' });

  res.json(stream);
});

app.get('/', (_, res) => res.json({ status: '✅ RAFN Server شغال' }));

app.listen(process.env.PORT || 3000);

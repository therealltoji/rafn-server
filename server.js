const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ══════════════════════════════════════
//  Consumet instances — يجرب الأول ثم الثاني
// ══════════════════════════════════════
const CONSUMET = [
  'https://consumet-api-production-97c4.up.railway.app',
  'https://consumet-instance.vercel.app',
];

async function consumet(path) {
  for (const base of CONSUMET) {
    try {
      const r = await fetch(base + path, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://zoro.to' },
        timeout: 10000,
      });
      if (r.ok) {
        const j = await r.json();
        if (j) return j;
      }
    } catch (_) {}
  }
  return null;
}

// ══════════════════════════════════════
//  /api/auto — يجيب رابط البث تلقائي
//  المعاملات: title, malId, ep
// ══════════════════════════════════════
app.get('/api/auto', async (req, res) => {
  const { title, malId, ep = 1 } = req.query;
  if (!title) return res.status(400).json({ error: 'title مطلوب' });

  console.log(`[RAFN] طلب: "${title}" — الحلقة ${ep}`);

  try {
    // 1️⃣ ابحث عن الأنمي في Zoro
    const search = await consumet(`/anime/zoro/${encodeURIComponent(title)}`);
    const results = search?.results;
    if (!results?.length) {
      return res.status(404).json({ error: 'الأنمي مو موجود', title });
    }

    // أفضل نتيجة مطابقة
    const best = results.find(r =>
      r.title?.toLowerCase().includes(title.toLowerCase().slice(0, 6))
    ) || results[0];

    console.log(`[RAFN] وجدت: ${best.title} (${best.id})`);

    // 2️⃣ جلب معلومات الأنمي والحلقات
    const info = await consumet(`/anime/zoro/info?id=${encodeURIComponent(best.id)}`);
    const episodes = info?.episodes || [];
    if (!episodes.length) {
      return res.status(404).json({ error: 'مافي حلقات' });
    }

    // إيجاد الحلقة المطلوبة
    const epNum = parseInt(ep);
    const episode = episodes.find(e => e.number === epNum) || episodes[epNum - 1] || episodes[0];
    if (!episode) {
      return res.status(404).json({ error: `الحلقة ${ep} مو موجودة` });
    }

    console.log(`[RAFN] الحلقة: ${episode.id}`);

    // 3️⃣ جلب السيرفرات
    const servers = await consumet(`/anime/zoro/servers?episodeId=${encodeURIComponent(episode.id)}`);
    const srvList = Array.isArray(servers) ? servers : [];
    if (!srvList.length) {
      return res.status(404).json({ error: 'مافي سيرفرات' });
    }

    // 4️⃣ جرب كل سيرفر حتى تلاقي رابط
    for (const srv of srvList) {
      try {
        const sources = await consumet(
          `/anime/zoro/watch?episodeId=${encodeURIComponent(episode.id)}&server=${encodeURIComponent(srv.name)}`
        );
        const src = sources?.sources;
        if (!src?.length) continue;

        // الأفضل: m3u8 ثم أي رابط
        const best = src.find(s => s.isM3U8) || src[0];
        if (!best?.url) continue;

        console.log(`[RAFN] ✅ رابط من ${srv.name}`);

        return res.json({
          url: best.url,
          isM3U8: best.isM3U8 || false,
          quality: best.quality || 'auto',
          source: srv.name,
          epId: episode.id,
          subtitles: sources.subtitles || [],
          intro: sources.intro || null,
        });
      } catch (_) {}
    }

    res.status(503).json({ error: 'كل السيرفرات فشلت، جرب بعدين' });

  } catch (err) {
    console.error('[RAFN] خطأ:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
//  /api/stream — HLS proxy لحل CORS
// ══════════════════════════════════════
app.get('/api/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url مطلوب');

  const target = Buffer.from(url, 'base64').toString('utf8');
  console.log(`[PROXY] ${target.slice(0, 80)}...`);

  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://zoro.to/',
        'Origin': 'https://zoro.to',
      },
    });

    res.set('Content-Type', r.headers.get('content-type') || 'application/vnd.apple.mpegurl');
    res.set('Access-Control-Allow-Origin', '*');

    // لو m3u8 — نعدّل الروابط الداخلية تمر من البروكسي
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('mpegurl') || target.includes('.m3u8')) {
      let text = await r.text();
      const base = target.substring(0, target.lastIndexOf('/') + 1);
      // نحوّل الروابط النسبية لمطلقة ثم نمررها من البروكسي
      text = text.replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
        const abs = match.startsWith('http') ? match : base + match;
        return `/api/stream?url=${Buffer.from(abs).toString('base64')}`;
      });
      text = text.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
        const abs = match.startsWith('http') ? match : base + match;
        return `/api/stream?url=${Buffer.from(abs).toString('base64')}`;
      });
      return res.send(text);
    }

    r.body.pipe(res);
  } catch (err) {
    console.error('[PROXY] خطأ:', err.message);
    res.status(500).send('فشل البروكسي');
  }
});

// ══════════════════════════════════════
//  /api/translate — ترجمة بالذكاء الاصطناعي
// ══════════════════════════════════════
app.post('/api/translate', async (req, res) => {
  const { title, episode, apiKey } = req.body;
  if (!title || !apiKey) return res.status(400).json({ error: 'title و apiKey مطلوبان' });

  const prompt = `أنت مترجم محترف متخصص في الأنمي. اكتب ملخصاً وتحليلاً شاملاً للحلقة ${episode} من أنمي "${title}".

اكتب باللغة العربية وتضمّن:
1. ملخص أحداث الحلقة
2. أبرز المشاهد
3. تطور الشخصيات
4. توقعات الحلقة القادمة

أسلوب شيق يناسب عشاق الأنمي العرب، 200-250 كلمة.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await r.json();
    res.json({ text: d?.content?.[0]?.text || 'تعذرت الترجمة' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check
app.get('/', (req, res) => res.json({ status: '🟢 رافن سيرفر شغال', version: '1.0' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ رافن سيرفر شغال على بورت ${PORT}`));

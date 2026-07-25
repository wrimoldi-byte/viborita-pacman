const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRtp(text) {
  const patterns = [
    /(?:RTP|return to player|retorno al jugador)[^0-9]{0,40}(8[5-9]|9\d|100)[.,](\d{1,2})\s*%/ig,
    /(8[5-9]|9\d|100)[.,](\d{1,2})\s*%[^.]{0,45}(?:RTP|return to player|retorno al jugador)/ig,
    /(?:RTP|return to player|retorno al jugador)[^0-9]{0,40}(8[5-9]|9\d|100)\s*%/ig
  ];
  const values = [];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) && values.length < 20) {
      const value = Number(`${match[1]}.${match[2] || 0}`);
      if (value >= 85 && value <= 100) values.push(value);
    }
  }
  return [...new Set(values)].sort((a, b) => b - a);
}

function decodeDuckUrl(url) {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    return parsed.searchParams.get('uddg') || parsed.href;
  } catch {
    return url;
  }
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RTPVerifier/1.0)',
      'Accept-Language': 'es,en;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`search_${res.status}`);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    results.push({ url: decodeDuckUrl(m[1]), title: cleanText(m[2]) });
  }
  return results;
}

function sourceScore(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/pragmaticplay|playngo|netent|redtiger|hacksawgaming|relax-gaming|pushgaming|nolimitcity|elk-studios|spribe/i.test(host)) return 5;
  if (/betano/i.test(host)) return 4;
  if (/casino|slot|gaming/i.test(host)) return 2;
  return 1;
}

async function inspectResult(result) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(result.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RTPVerifier/1.0)' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('text/plain')) return null;
    const html = (await res.text()).slice(0, 600000);
    const text = cleanText(html);
    const rtps = extractRtp(text);
    if (!rtps.length) return null;
    return { ...result, rtps, score: sourceScore(result.url) };
  } catch {
    return null;
  }
}

async function lookupGame(name) {
  const query = `"${name}" RTP slot official provider`;
  const results = await searchDuckDuckGo(query);
  const inspected = (await Promise.all(results.slice(0, 5).map(inspectResult))).filter(Boolean);
  inspected.sort((a, b) => b.score - a.score);
  const best = inspected[0];
  if (!best) {
    return { name, status: 'not_verified', rtp: null, variants: [], source: null };
  }
  const variants = [...new Set(inspected.flatMap(x => x.rtps))].sort((a, b) => b - a).slice(0, 6);
  return {
    name,
    status: 'verified_web',
    rtp: best.rtps[0],
    variants,
    source: { title: best.title, url: best.url },
    checkedAt: new Date().toISOString()
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ ok: true, service: 'RTP lookup' });
    try {
      const body = await request.json();
      const games = Array.isArray(body.games) ? body.games.map(String).map(x => x.trim()).filter(Boolean).slice(0, 12) : [];
      if (!games.length) return json({ error: 'games_required' }, 400);
      const data = [];
      for (const game of games) data.push(await lookupGame(game));
      return json({ results: data });
    } catch (error) {
      return json({ error: 'lookup_failed', detail: String(error?.message || error) }, 500);
    }
  }
};

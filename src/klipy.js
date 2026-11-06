// Recherche de GIF KLIPY; les réponses sont gardées 15 minutes en mémoire, pas les médias.
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 8_000;
export const RESULTS_PER_SEARCH = 24;

const cache = new Map();
export const klipyEnabled = () => Boolean(process.env.KLIPY_API_KEY);
export class KlipyError extends Error {}

async function fetchList(customerId, endpoint, q) {
  const key = JSON.stringify([process.env.KLIPY_API_KEY, customerId, endpoint, q]);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.results;

  const params = new URLSearchParams({
    page: '1', per_page: String(RESULTS_PER_SEARCH), customer_id: customerId,
    locale: 'fr', format_filter: 'gif', content_filter: 'high',
    ...(q ? { q } : {}),
  });
  let res;
  try {
    res = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(process.env.KLIPY_API_KEY)}/gifs/${endpoint}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new KlipyError('KLIPY ne répond pas pour le moment.');
  }
  if (res.status === 429) throw new KlipyError('Trop de recherches en ce moment, réessaie dans quelques minutes.');
  if (!res.ok) throw new KlipyError(`KLIPY a répondu avec une erreur (${res.status}).`);

  let results;
  try {
    const body = await res.json();
    if (body.result !== true || !Array.isArray(body.data?.data)) throw new Error('invalid response');
    results = body.data.data.map((gif) => {
      const url = gif.file?.hd?.gif?.url || gif.file?.md?.gif?.url || gif.file?.sm?.gif?.url || gif.file?.xs?.gif?.url;
      const preview = gif.file?.xs?.gif?.url || gif.file?.sm?.gif?.url || url;
      if (!url || !preview) throw new Error('missing GIF');
      return { id: gif.id, url, preview, title: gif.title };
    });
  } catch {
    throw new KlipyError('KLIPY a renvoyé une réponse invalide.');
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { results, exp: Date.now() + CACHE_TTL_MS });
  return results;
}

export const trendingGifs = (customerId) => fetchList(customerId, 'trending');
export function searchGifs(query, customerId) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return fetchList(customerId, 'search', q);
}

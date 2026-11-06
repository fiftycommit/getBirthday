// Seules les listes de résultats sont gardées en cache.
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 8_000;
const cache = new Map();

export const giphyEnabled = () => Boolean(process.env.GIPHY_API_KEY);
export class GiphyError extends Error {}

async function fetchList(endpoint, query) {
  const key = JSON.stringify([process.env.GIPHY_API_KEY, endpoint, query]);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.results;
  const params = new URLSearchParams({ api_key: process.env.GIPHY_API_KEY, limit: '24', rating: 'g', lang: 'fr', ...(query ? { q: query } : {}) });
  let res;
  try {
    res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GiphyError('GIPHY ne répond pas pour le moment.');
  }
  if (res.status === 429) throw new GiphyError('Trop de recherches GIPHY en ce moment, réessaie dans quelques minutes.');
  if (!res.ok) throw new GiphyError(`GIPHY a répondu avec une erreur (${res.status}).`);
  let results;
  try {
    const body = await res.json();
    if (!Array.isArray(body.data) || (body.meta && body.meta.status !== 200)) throw new Error('invalid response');
    results = body.data.map((gif) => {
      const url = gif.images?.original?.url;
      const preview = gif.images?.fixed_width_small?.url || gif.images?.fixed_width?.url || url;
      if (!url || !preview) throw new Error('missing GIF');
      return { id: gif.id, url, preview, title: gif.title };
    });
  } catch {
    throw new GiphyError('GIPHY a renvoyé une réponse invalide.');
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { results, exp: Date.now() + CACHE_TTL_MS });
  return results;
}

export const trendingGifs = () => fetchList('trending');
export const searchGifs = (query) => fetchList('search', query.trim().toLowerCase().replace(/\s+/g, ' '));

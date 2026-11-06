// Recherche de GIF via l'API Giphy (la clé gratuite est limitée à 100 requêtes/heure: cache des résultats).
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 8_000;
export const RESULTS_PER_SEARCH = 25;

const cache = new Map(); // requête normalisée -> {results, exp}

export const giphyEnabled = () => Boolean(process.env.GIPHY_API_KEY);

export class GiphyError extends Error {}

/** @returns {Promise<{id: string, url: string, preview: string, title: string}[]>} (url = page Giphy, dépliée par Discord) */
export async function searchGifs(query) {
  const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.results;

  const params = new URLSearchParams({
    api_key: process.env.GIPHY_API_KEY, q: key, limit: String(RESULTS_PER_SEARCH),
    rating: 'g', lang: 'fr', bundle: 'messaging_non_clips',
  });
  let res;
  try {
    res = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GiphyError('Giphy ne répond pas pour le moment.');
  }
  if (res.status === 429) throw new GiphyError('Trop de recherches en ce moment, réessaie dans quelques minutes.');
  if (!res.ok) throw new GiphyError(`Giphy a répondu avec une erreur (${res.status}).`);

  const { data } = await res.json();
  const results = data.map((g) => ({
    id: g.id,
    url: g.url,
    preview: g.images.fixed_height.url,
    title: g.title,
  }));

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // le plus ancien
  cache.set(key, { results, exp: Date.now() + CACHE_TTL_MS });
  return results;
}

import { json, readRepoSettings } from '../_lib.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const cacheKey = new Request(new URL('/api/settings', request.url));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const { settings, sha } = await readRepoSettings(env);
    const response = json({ settings, sha });
    response.headers.set('cache-control', 'public, max-age=15');
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ error: error.message || 'Could not load published calculator settings.' }, 503);
  }
}
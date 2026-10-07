import { json, readRepoSettings, validateSettings, verifySession, writeRepoSettings } from '../_lib.js';

export async function onRequestPost({ request, env, waitUntil }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
  const session = await verifySession(request, env);
  if (!session) return json({ error: 'Sign in with an approved GitHub account to publish.' }, 401);

  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'Send settings as JSON.' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 128000) return json({ error: 'Settings payload is too large.' }, 413);

  try {
    const raw = await request.text();
    if (raw.length > 128000) return json({ error: 'Settings payload is too large.' }, 413);
    const body = JSON.parse(raw);
    const settings = validateSettings(body.settings);
    if (settings.error) return json({ error: settings.error }, 400);
    if (typeof body.sha !== 'string' || !body.sha) return json({ error: 'Load the published settings before publishing.' }, 400);

    const current = await readRepoSettings(env);
    if (current.sha !== body.sha) return json({ error: 'The repo settings changed since this page loaded. Load published settings, review them, and try again.' }, 409);
    const published = await writeRepoSettings(env, settings, current.sha, session.login);
    waitUntil(caches.default.delete(new Request(new URL('/api/settings', request.url))));
    return json({ sha: published.sha, commit: published.commit, publishedBy: session.login });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'The settings request is not valid JSON.' }, 400);
    return json({ error: error.message || 'Could not publish calculator settings.' }, 502);
  }
}
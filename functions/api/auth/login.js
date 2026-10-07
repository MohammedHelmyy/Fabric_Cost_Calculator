import { text } from '../../_lib.js';

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.APP_ORIGIN) return text('GitHub sign-in is not configured yet.', 503);
  const appOrigin = new URL(env.APP_ORIGIN).origin;
  if (new URL(request.url).origin !== appOrigin) return text('Unexpected application URL.', 400);
  const state = randomState();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${appOrigin}/api/auth/callback`);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      'set-cookie': `oauth_state=${state}; Path=/api/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'cache-control': 'no-store'
    }
  });
}
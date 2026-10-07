import { createSession, isAllowed, requiredEnv, sessionCookie, text } from '../../_lib.js';

function cookieValue(request, name) {
  const entry = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

export async function onRequestGet({ request, env }) {
  try {
    requiredEnv(env, ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'APP_ORIGIN', 'ALLOWED_GITHUB_USERS', 'SESSION_SECRET']);
    const appOrigin = new URL(env.APP_ORIGIN).origin;
    const currentUrl = new URL(request.url);
    if (currentUrl.origin !== appOrigin) return text('Unexpected application URL.', 400);
    const state = currentUrl.searchParams.get('state') || '';
    const savedState = cookieValue(request, 'oauth_state');
    if (!state || !savedState || state !== savedState) return text('Sign-in state expired. Please try again.', 400);
    if (currentUrl.searchParams.has('error')) return text('GitHub sign-in was cancelled.', 401);

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code: currentUrl.searchParams.get('code'), state })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return text('GitHub sign-in could not be completed.', 401);

    const userResponse = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenData.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    });
    const user = await userResponse.json();
    if (!userResponse.ok || !user.login) return text('Could not verify your GitHub account.', 401);
    if (!isAllowed(user.login, env)) return text('This GitHub account is not allowed to publish calculator settings.', 403);

    const session = await createSession(user.login, env);
    const headers = new Headers({ location: `${appOrigin}/`, 'cache-control': 'no-store' });
    headers.append('set-cookie', sessionCookie(session));
    headers.append('set-cookie', 'oauth_state=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    return new Response(null, {
      status: 302,
      headers
    });
  } catch (error) {
    return text(error.message || 'Sign-in is not configured correctly.', 500);
  }
}
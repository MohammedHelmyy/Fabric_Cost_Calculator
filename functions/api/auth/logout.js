export async function onRequestPost({ request }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response('Invalid request origin.', { status: 403 });
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': 'calculator_session=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax', 'cache-control': 'no-store' }
  });
}
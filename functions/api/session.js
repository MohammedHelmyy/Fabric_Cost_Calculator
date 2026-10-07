import { json, verifySession } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const session = await verifySession(request, env);
  return session ? json({ login: session.login }) : json({ login: null }, 401);
}
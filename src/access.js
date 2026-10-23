/* Checks the Cloudflare Access token on /admin requests. Access signs every request it lets
 * through with an RS256 JWT in Cf-Access-Jwt-Assertion; this verifies it against the team's
 * published keys, the application audience, and the list of maintainers. Until ACCESS_TEAM_DOMAIN
 * and ACCESS_AUD are set, every admin request is refused.
 */
import { unbase64url } from './token.js';

const decoder = new TextDecoder();
let cachedKeys = { team: null, at: 0, keys: [] };

function part(segment) {
  return JSON.parse(decoder.decode(unbase64url(segment)));
}

async function teamKeys(team, fetcher) {
  if (cachedKeys.team === team && Date.now() - cachedKeys.at < 3600 * 1000) return cachedKeys.keys;
  const response = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs ${response.status}`);
  const { keys } = await response.json();
  cachedKeys = { team, at: Date.now(), keys };
  return keys;
}

export function resetAccessKeys() {
  cachedKeys = { team: null, at: 0, keys: [] };
}

/* Returns the maintainer's email, or null when the request is not from a signed-in maintainer. */
export async function maintainer(request, env, fetcher = fetch, now = Date.now()) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const allowed = String(env.MAINTAINERS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!team || !audience || !allowed.length || !token) return null;
  try {
    const [head, body, signature] = token.split('.');
    const header = part(head);
    const claims = part(body);
    if (header.alg !== 'RS256') return null;
    const jwk = (await teamKeys(team, fetcher)).find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unbase64url(signature), new TextEncoder().encode(`${head}.${body}`));
    if (!valid) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) return null;
    if (claims.iss !== `https://${team}`) return null;
    if (!claims.exp || claims.exp * 1000 < now) return null;
    const email = String(claims.email || '').toLowerCase();
    return allowed.includes(email) ? email : null;
  } catch (_) {
    return null;
  }
}

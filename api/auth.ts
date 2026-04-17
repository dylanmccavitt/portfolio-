export const config = { runtime: 'nodejs22.x' };

interface AuthQuery {
  code?: string;
  state?: string;
  provider?: string;
  error?: string;
}

const ALLOWED_ORIGIN = 'https://dylanmccavitt.xyz';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams) as AuthQuery;

  if (!params.code) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return new Response('Missing GITHUB_CLIENT_ID env var', { status: 500 });
    }
    const redirectUri = `${url.origin}/api/auth`;
    const state = crypto.randomUUID();
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'repo,user');
    authorizeUrl.searchParams.set('state', state);
    return Response.redirect(authorizeUrl.toString(), 302);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Missing GitHub OAuth env vars', { status: 500 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  const status = tokenData.access_token ? 'success' : 'error';
  const payload = tokenData.access_token
    ? { token: tokenData.access_token, provider: 'github' }
    : { error: tokenData.error_description ?? tokenData.error ?? 'oauth_failed' };

  const html = `<!doctype html>
<html><body><script>
(function() {
  function send() {
    window.opener && window.opener.postMessage(
      'authorization:github:${status}:' + ${JSON.stringify(JSON.stringify(payload))},
      ${JSON.stringify(ALLOWED_ORIGIN)}
    );
  }
  window.addEventListener('message', function once() {
    window.removeEventListener('message', once, false);
    send();
    setTimeout(function() { window.close(); }, 100);
  }, false);
  send();
  setTimeout(function() { window.close(); }, 1000);
})();
</script></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

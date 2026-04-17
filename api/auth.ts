interface AuthQuery {
  code?: string;
}

interface ApiRequest {
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): ApiResponse;
  send(body: string): void;
}

interface OAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://www.dylanmccavitt.xyz';

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const sendRedirect = (res: ApiResponse, location: string): void => {
  res.status(302);
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.send('');
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const params: AuthQuery = {
    code: first(req.query?.code),
  };

  if (!params.code) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      res.status(500).send('Missing GITHUB_CLIENT_ID env var');
      return;
    }

    const redirectUri = `${SITE_ORIGIN}/api/auth`;
    const state = crypto.randomUUID();
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'repo,user');
    authorizeUrl.searchParams.set('state', state);
    sendRedirect(res, authorizeUrl.toString());
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send('Missing GitHub OAuth env vars');
    return;
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

  const tokenData = (await tokenRes.json()) as OAuthTokenResponse;
  const status = tokenData.access_token ? 'success' : 'error';
  const payload = tokenData.access_token
    ? { token: tokenData.access_token, provider: 'github' }
    : { error: tokenData.error_description ?? tokenData.error ?? 'oauth_failed' };
  const message = `authorization:github:${status}:` + JSON.stringify(payload);

  const html = `<!doctype html>
<html><body><script>
(function() {
  var message = ${JSON.stringify(message)};
  window.addEventListener('message', function(e) {
    if (e.data === 'authorizing:github') {
      window.opener && window.opener.postMessage(message, e.origin);
    }
  });
  window.opener && window.opener.postMessage('authorizing:github', '*');
})();
</script></body></html>`;

  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}

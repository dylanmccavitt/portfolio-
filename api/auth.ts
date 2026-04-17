interface AuthQuery {
  code?: string;
  state?: string;
  provider?: string;
  error?: string;
}

const ALLOWED_ORIGIN = 'https://dylanmccavitt.xyz';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url, ALLOWED_ORIGIN);
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

  const message = `authorization:github:${status}:` + JSON.stringify(payload);

  const html = `<!doctype html>
<html><body style="font-family:monospace;padding:16px;">
<h2>Auth debug</h2>
<pre id="log"></pre>
<script>
(function() {
  var message = ${JSON.stringify(message)};
  var logEl = document.getElementById('log');
  function log(s) {
    logEl.textContent += s + '\\n';
    console.log('[auth-popup]', s);
  }
  log('popup loaded at: ' + location.href);
  log('window.opener: ' + (window.opener ? 'present' : 'NULL'));
  log('document.referrer: ' + document.referrer);
  log('payload status: ' + ${JSON.stringify(status)});
  log('message length: ' + message.length);
  window.addEventListener('message', function(e) {
    log('received msg origin=' + e.origin + ' data=' + (typeof e.data === 'string' ? e.data.slice(0,80) : typeof e.data));
    if (e.data === 'authorizing:github') {
      try {
        window.opener.postMessage(message, e.origin);
        log('posted success message to opener at ' + e.origin);
      } catch (err) {
        log('FAILED to post: ' + err.message);
      }
    }
  });
  if (window.opener) {
    try {
      window.opener.postMessage('authorizing:github', '*');
      log('posted authorizing:github to opener with target=*');
    } catch (err) {
      log('FAILED initial post: ' + err.message);
    }
  } else {
    log('NO opener — cannot continue');
  }
})();
</script></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

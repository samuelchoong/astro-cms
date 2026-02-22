interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OAUTH_AUTHORIZE_URL: string;
  OAUTH_TOKEN_URL: string;
  SCOPES: string;
}

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function getCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/callback`;
}

function randomState(): string {
  return crypto.randomUUID();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    if (url.pathname === '/auth') {
      const state = randomState();
      const redirect = new URL(env.OAUTH_AUTHORIZE_URL);
      redirect.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      redirect.searchParams.set('redirect_uri', getCallbackUrl(request));
      redirect.searchParams.set('scope', env.SCOPES);
      redirect.searchParams.set('state', state);

      const response = Response.redirect(redirect.toString(), 302);
      response.headers.append('Set-Cookie', `decap_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
      return response;
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookieState = request.headers.get('Cookie')?.match(/decap_oauth_state=([^;]+)/)?.[1];

      if (!code || !state || !cookieState || state !== cookieState) {
        return new Response('Invalid OAuth state.', { status: 400 });
      }

      const tokenRes = await fetch(env.OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: getCallbackUrl(request),
          state
        })
      });

      if (!tokenRes.ok) {
        return new Response('OAuth token exchange failed.', { status: 502 });
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        return new Response('Missing access token.', { status: 502 });
      }

      const html = `<!doctype html><html><body><script>
(function() {
  function receiveMessage(e) {
    window.opener.postMessage('authorization:github:success:{"token":"${tokenData.access_token}"}', e.origin);
  }
  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script></body></html>`;

      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'Set-Cookie': 'decap_oauth_state=deleted; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

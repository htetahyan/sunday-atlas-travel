// Minimal GitHub OAuth proxy for Decap CMS (Sunday Atlas Travel).
// Secrets GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are worker secrets, never in git.
// ALLOWED_ORIGINS: comma-separated site origins allowed to receive the token.

const html = (body, headers = {}) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    headers: { "content-type": "text/html;charset=utf-8", ...headers },
  });

function cookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function reply(status, content, origins) {
  const payload = JSON.stringify(content);
  return html(`<script>
(function(){
  var allowed = ${JSON.stringify(origins)};
  var msg = "authorization:github:${status}:" + ${JSON.stringify(payload)};
  function receive(e){
    if (allowed.indexOf(e.origin) === -1) return;
    window.opener.postMessage(msg, e.origin);
    window.removeEventListener("message", receive, false);
  }
  window.addEventListener("message", receive, false);
  allowed.forEach(function(o){ window.opener && window.opener.postMessage("authorizing:github", o); });
})();
</script><p>Signing you in…</p>`, { "set-cookie": "decap_state=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax" });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origins = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

    if (url.pathname === "/auth") {
      if (!env.GITHUB_CLIENT_ID) return new Response("OAuth client not configured", { status: 503 });
      const state = crypto.randomUUID();
      const gh = new URL("https://github.com/login/oauth/authorize");
      gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      gh.searchParams.set("redirect_uri", `${url.origin}/callback`);
      gh.searchParams.set("scope", url.searchParams.get("scope") || "repo,user");
      gh.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          location: gh.toString(),
          "set-cookie": `decap_state=${state}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`,
        },
      });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || state !== cookie(req, "decap_state")) {
        return reply("error", { message: "Invalid OAuth state" }, origins);
      }
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "user-agent": "rare-atlas-cms-auth" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.access_token) return reply("error", { message: data.error_description || "Token exchange failed" }, origins);
      return reply("success", { token: data.access_token, provider: "github" }, origins);
    }

    return new Response("Sunday Atlas CMS auth proxy", { status: 200 });
  },
};

# Game Hub

Quick, tappable browser games (plus a hidden web SSH client at `/ssh`). Plain
static files, no build step needed to play: open `index.html`.

## Hosting on Cloudflare Workers

The hub runs as one Cloudflare Worker: the files are served by Workers Static
Assets, and the same Worker hosts the SSH page's relay at `/ssh/relay`.

- `wrangler.jsonc` – Worker config (no secrets in it)
- `worker/build.mjs` – copies `index.html`, `games/`, `shared/` and `ssh/` into
  `dist/` (skipping `tools/` folders); runs automatically before dev/deploy
- `worker/index.js` – Worker script; routes `/ssh/relay` to
  `ssh/worker/worker.js`, everything else to the static files

### Environment variables

All tokens live in env vars / secrets, never in the repo.

| Where | Name | What |
| --- | --- | --- |
| Worker secret | `TOKEN` | SSH relay token, 32+ characters (the SSH page's "Generate token" button makes one) |
| Worker secret or variable | `ALLOW` | SSH servers the relay may reach, comma-separated `host[:port]` |
| Worker variable (optional) | `ORIGIN` | Page origin(s) allowed to use the relay; defaults to the Worker's own |
| GitHub Actions secret | `CLOUDFLARE_API_TOKEN` | API token from the "Edit Cloudflare Workers" template |
| GitHub Actions secret | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| GitHub Actions secret (optional) | `SSH_RELAY_TOKEN`, `SSH_RELAY_ALLOW` | Pushed to the Worker as `TOKEN` / `ALLOW` on each deploy |

The games work without any of them; only the SSH relay needs `TOKEN` and `ALLOW`.

### Deploy

- **From GitHub:** add the `CLOUDFLARE_*` secrets above. Every push to `main`
  then deploys via `.github/workflows/cloudflare.yml`.
- **From a computer:**
  ```sh
  npm install
  npx wrangler login            # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
  npx wrangler secret put TOKEN
  npx wrangler secret put ALLOW
  npm run deploy
  ```

### Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in TOKEN / ALLOW; git-ignored
npm run dev                      # http://localhost:8787
```

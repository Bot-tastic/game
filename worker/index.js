// Cloudflare Worker for the Game Hub.
//
// Static files (the hub, games, shared/, ssh/) are served by Workers Static
// Assets before this script runs; see wrangler.jsonc. This script handles:
//   /ssh/relay  the SSH page's WebSocket → TCP relay (needs TOKEN and ALLOW)
//   anything else that reached it: handed to the asset server for its 404.
//
// Secrets and settings come only from env (Worker secrets / variables):
//   TOKEN   (secret, required for /ssh/relay)  32+ characters
//   ALLOW   (required for /ssh/relay)          comma-separated host[:port]
//   ORIGIN  (optional)                         comma-separated page origins allowed
//                                              to use the relay (default: this Worker's)

import sshRelay from '../ssh/worker/worker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/ssh/relay') {
      return sshRelay.fetch(request, { ...env, ORIGIN: env.ORIGIN || url.origin }, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};

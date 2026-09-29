// Entry point, run by pm2 (see ecosystem.config.cjs).
//
// Configuration comes from an env file kept outside the deployed directory so
// a deploy can never overwrite or delete it. See docs/SERVER.md.

import { OAuth2Client } from "google-auth-library";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

const envFile = process.env.ENV_FILE ?? "/var/lib/game-hub/.env";
try {
  process.loadEnvFile(envFile);
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  console.warn(`No env file at ${envFile}, using the process environment only.`);
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required setting ${name} (in ${envFile}).`);
    process.exit(1);
  }
  return v;
}

const googleClientId = required("GOOGLE_CLIENT_ID");
const publicOrigin = required("PUBLIC_ORIGIN").replace(/\/$/, "");
const port = Number(process.env.PORT ?? 3100);
const dbFile = process.env.DB_FILE ?? "/var/lib/game-hub/game-hub.db";

const google = new OAuth2Client(googleClientId);
const verifyGoogle = async (idToken) => {
  // Checks signature, expiry, issuer and that the token was minted for us.
  const ticket = await google.verifyIdToken({ idToken, audience: googleClientId });
  return ticket.getPayload();
};

const db = openDb(dbFile);
const app = await buildApp({ db, verifyGoogle, googleClientId, publicOrigin, logger: true });

setInterval(() => db.purgeSessions(), 6 * 3600 * 1000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Loopback only: the outside world reaches us through nginx.
await app.listen({ host: "127.0.0.1", port });

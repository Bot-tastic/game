// The HTTP API. nginx serves the games themselves as static files and proxies
// /api/ here, so every request is same-origin and a plain HttpOnly cookie is
// all the session machinery needed.
//
//   GET    /api/config            what the browser needs to render sign-in
//   POST   /api/auth/google       exchange a Google ID token for a session
//   POST   /api/auth/logout
//   GET    /api/me                current user, or 401
//   PATCH  /api/me                change nickname
//   DELETE /api/me                delete the account and everything in it
//   GET    /api/saves             list of cloud saves (no data)
//   GET    /api/saves/:game       one game's save
//   PUT    /api/saves/:game       replace one game's save
//
// buildApp takes its dependencies as arguments so the tests can run it against
// an in-memory database and a fake Google verifier.

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes, randomInt } from "node:crypto";

export const GAMES = ["hill-climb", "balloon-siege", "geo-dash", "formula-legion", "demolition-run"];
const SESSION_COOKIE = "gh_session";
const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
const MAX_SAVE_BYTES = 512 * 1024;
const NAME_RE = /^[\p{L}\p{N} _.-]{3,20}$/u;

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

/**
 * @param {object} opts
 * @param {ReturnType<import("./db.js").openDb>} opts.db
 * @param {(idToken: string) => Promise<{sub: string} | null>} opts.verifyGoogle
 * @param {string} opts.googleClientId
 * @param {string} opts.publicOrigin  e.g. "https://games.example.com"
 * @param {boolean} [opts.secureCookies]
 * @param {boolean} [opts.logger]
 */
export async function buildApp({ db, verifyGoogle, googleClientId, publicOrigin, secureCookies = true, logger = false }) {
  const app = Fastify({
    logger,
    // nginx on the same host is the only proxy we trust for X-Forwarded-For.
    trustProxy: "127.0.0.1",
    bodyLimit: MAX_SAVE_BYTES + 16 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // CSRF: the session cookie is SameSite=Lax, and on top of that every request
  // that changes something must come from our own page.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (req.headers.origin !== publicOrigin) {
      return reply.code(403).send({ error: "bad_origin" });
    }
  });

  const setSession = (reply, userId) => {
    const token = randomBytes(32).toString("base64url");
    db.createSession(hashToken(token), userId, SESSION_TTL_MS);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
    });
  };

  const currentUser = (req) => {
    const token = req.cookies[SESSION_COOKIE];
    return token ? db.sessionUser(hashToken(token)) : null;
  };

  /** preHandler for routes that need a signed-in user. */
  const requireUser = async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: "signed_out" });
    req.user = user;
  };

  const publicUser = (u) => ({ id: u.id, name: u.name, createdAt: u.created_at });

  app.get("/api/config", async () => ({ googleClientId, games: GAMES }));

  app.post("/api/auth/google", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length > 4096) {
      return reply.code(400).send({ error: "bad_request" });
    }
    let payload = null;
    try {
      payload = await verifyGoogle(credential);
    } catch (err) {
      req.log.warn({ err: err.message }, "google token rejected");
    }
    if (!payload?.sub) return reply.code(401).send({ error: "invalid_token" });

    const { user, created } = db.findOrCreateUser(String(payload.sub), () => `Player${randomInt(1000, 10000)}`);
    setSession(reply, user.id);
    return { user: publicUser(user), created };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.deleteSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (req) => ({ user: publicUser(req.user) }));

  app.patch("/api/me", { preHandler: requireUser }, async (req, reply) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: "bad_name" });
    db.renameUser(req.user.id, name);
    return { user: { ...publicUser(req.user), name } };
  });

  app.delete("/api/me", { preHandler: requireUser }, async (req, reply) => {
    db.deleteUser(req.user.id); // sessions and saves go with it (ON DELETE CASCADE)
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/saves", { preHandler: requireUser }, async (req) => ({
    saves: db.listSaves(req.user.id).map((s) => ({ game: s.game, rev: s.rev, updatedAt: s.updated_at })),
  }));

  const gameParam = (req, reply) => {
    const game = req.params.game;
    if (!GAMES.includes(game)) {
      reply.code(404).send({ error: "unknown_game" });
      return null;
    }
    return game;
  };

  app.get("/api/saves/:game", { preHandler: requireUser }, async (req, reply) => {
    const game = gameParam(req, reply);
    if (!game) return reply;
    const save = db.getSave(req.user.id, game);
    if (!save) return { save: null };
    return { save: { data: JSON.parse(save.data), rev: save.rev, updatedAt: save.updated_at } };
  });

  app.put("/api/saves/:game", {
    preHandler: requireUser,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const game = gameParam(req, reply);
    if (!game) return reply;
    const data = req.body?.data;
    // A save is a flat map of localStorage keys to string values.
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return reply.code(400).send({ error: "bad_request" });
    }
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== "string" || k.length > 200) return reply.code(400).send({ error: "bad_request" });
    }
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > MAX_SAVE_BYTES) return reply.code(413).send({ error: "too_large" });
    const { rev, updated_at: updatedAt } = db.putSave(req.user.id, game, json);
    return { rev, updatedAt };
  });

  return app;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const ORIGIN = "https://games.example.test";

async function setup() {
  const db = openDb(":memory:");
  // Fake Google: "good:<sub>" is a valid token for account <sub>.
  const verifyGoogle = async (t) => (t.startsWith("good:") ? { sub: t.slice(5) } : null);
  const app = await buildApp({ db, verifyGoogle, googleClientId: "cid", publicOrigin: ORIGIN, secureCookies: false });
  return { app, db };
}

const cookieOf = (res) => res.headers["set-cookie"]?.split(";")[0];

async function login(app, sub = "alice") {
  const res = await app.inject({
    method: "POST", url: "/api/auth/google", headers: { origin: ORIGIN },
    payload: { credential: `good:${sub}` },
  });
  assert.equal(res.statusCode, 200);
  return { cookie: cookieOf(res), body: res.json() };
}

test("config is public", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/api/config" });
  assert.equal(res.json().googleClientId, "cid");
});

test("sign-in creates the user once and sets a session", async () => {
  const { app } = await setup();
  const first = await login(app);
  assert.equal(first.body.created, true);
  assert.match(first.body.user.name, /^Player\d{4}$/);
  const again = await login(app);
  assert.equal(again.body.created, false);
  assert.equal(again.body.user.id, first.body.user.id);

  const me = await app.inject({ url: "/api/me", headers: { cookie: first.cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, first.body.user.id);
});

test("bad tokens and missing sessions are rejected", async () => {
  const { app } = await setup();
  const bad = await app.inject({
    method: "POST", url: "/api/auth/google", headers: { origin: ORIGIN }, payload: { credential: "forged" },
  });
  assert.equal(bad.statusCode, 401);
  assert.equal((await app.inject({ url: "/api/me" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/me", headers: { cookie: "gh_session=nope" } })).statusCode, 401);
});

test("writes from another origin are refused", async () => {
  const { app } = await setup();
  const { cookie } = await login(app);
  for (const origin of [undefined, "https://evil.example"]) {
    const res = await app.inject({
      method: "PUT", url: "/api/saves/hill-climb", headers: { cookie, ...(origin ? { origin } : {}) },
      payload: { data: { "hillclimb:coins": "1000000" } },
    });
    assert.equal(res.statusCode, 403);
  }
});

test("saves round-trip and bump their revision", async () => {
  const { app } = await setup();
  const { cookie } = await login(app);
  const headers = { cookie, origin: ORIGIN };

  assert.deepEqual((await app.inject({ url: "/api/saves/hill-climb", headers })).json(), { save: null });

  const put1 = await app.inject({ method: "PUT", url: "/api/saves/hill-climb", headers, payload: { data: { "hillclimb:coins": "150" } } });
  assert.equal(put1.json().rev, 1);
  const put2 = await app.inject({ method: "PUT", url: "/api/saves/hill-climb", headers, payload: { data: { "hillclimb:coins": "300" } } });
  assert.equal(put2.json().rev, 2);

  const got = (await app.inject({ url: "/api/saves/hill-climb", headers })).json().save;
  assert.deepEqual(got.data, { "hillclimb:coins": "300" });
  assert.equal(got.rev, 2);

  const list = (await app.inject({ url: "/api/saves", headers })).json().saves;
  assert.equal(list.length, 1);
  assert.equal(list[0].game, "hill-climb");
});

test("saves are private to their owner", async () => {
  const { app } = await setup();
  const a = await login(app, "alice");
  const b = await login(app, "bob");
  await app.inject({ method: "PUT", url: "/api/saves/geo-dash", headers: { cookie: a.cookie, origin: ORIGIN }, payload: { data: { k: "a" } } });
  const seen = (await app.inject({ url: "/api/saves/geo-dash", headers: { cookie: b.cookie } })).json();
  assert.equal(seen.save, null);
});

test("save validation", async () => {
  const { app } = await setup();
  const { cookie } = await login(app);
  const headers = { cookie, origin: ORIGIN };
  const put = (url, payload) => app.inject({ method: "PUT", url, headers, payload });
  assert.equal((await put("/api/saves/not-a-game", { data: {} })).statusCode, 404);
  assert.equal((await put("/api/saves/hill-climb", { data: [1] })).statusCode, 400);
  assert.equal((await put("/api/saves/hill-climb", { data: { k: 5 } })).statusCode, 400);
  const huge = { k: "x".repeat(600 * 1024) };
  assert.ok([413].includes((await put("/api/saves/hill-climb", { data: huge })).statusCode));
});

test("nickname rules", async () => {
  const { app } = await setup();
  const { cookie } = await login(app);
  const headers = { cookie, origin: ORIGIN };
  const rename = (name) => app.inject({ method: "PATCH", url: "/api/me", headers, payload: { name } });
  assert.equal((await rename("Jakob_2")).statusCode, 200);
  assert.equal((await rename("Jörg Müller")).statusCode, 200);
  assert.equal((await rename("ab")).statusCode, 400);
  assert.equal((await rename("<script>")).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/me", headers })).json().user.name, "Jörg Müller");
});

test("logout ends the session, delete removes everything", async () => {
  const { app, db } = await setup();
  const { cookie } = await login(app);
  const headers = { cookie, origin: ORIGIN };
  await app.inject({ method: "PUT", url: "/api/saves/hill-climb", headers, payload: { data: { k: "v" } } });

  await app.inject({ method: "POST", url: "/api/auth/logout", headers });
  assert.equal((await app.inject({ url: "/api/me", headers })).statusCode, 401);

  const again = await login(app);
  const del = await app.inject({ method: "DELETE", url: "/api/me", headers: { cookie: again.cookie, origin: ORIGIN } });
  assert.equal(del.statusCode, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM users").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM saves").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
});

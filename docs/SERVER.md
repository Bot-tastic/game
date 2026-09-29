# Game Hub auf dem eigenen Server

Aufbau:

```
Browser ──HTTPS──> nginx (Certbot-Zertifikat)
                    ├─ /           statische Dateien aus /var/www/game-hub  (die Spiele)
                    └─ /api/       → Node.js auf 127.0.0.1:3100, verwaltet von pm2
                                      └─ SQLite: /var/lib/game-hub/game-hub.db
```

- **Login:** nur „Mit Google anmelden“. Gespeichert werden nur die anonyme Google-Konto-ID (`sub`) und ein Spitzname, den der Spieler wählt. Keine E-Mail, kein Name, kein Passwort.
- **Cloud-Spielstände:** Jedes Spiel speichert wie bisher im `localStorage`. `shared/cloud.js` spiegelt das bei angemeldeten Spielern auf den Server. Die Spiele selbst wissen davon nichts.
- **Ohne Server** (GitHub Pages, lokal geöffnet) bleibt alles wie bisher: keine Konto-Leiste, kein Sync.

Code: `server/` (API), `shared/cloud.js` (Sync), `shared/account.js` (Konto-Leiste im Hub), `.github/workflows/deploy-server.yml` (automatisches Deployment).

---

## Einmalige Einrichtung

Im Folgenden steht `games.example.com` für deine (Sub-)Domain und `deploy` für den Linux-Benutzer, unter dem pm2 bei dir läuft.

### 1. Google-Login einrichten

1. <https://console.cloud.google.com/> → Projekt anlegen (oder ein bestehendes nehmen).
2. **APIs & Dienste → OAuth-Zustimmungsbildschirm**:
   - Typ „Extern“.
   - App-Name, Support-E-Mail, Links zu Datenschutzerklärung und Impressum.
   - Keine zusätzlichen Scopes.
   - Danach **veröffentlichen**, sonst können sich nur eingetragene Testnutzer anmelden.
3. **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: **Webanwendung**
   - Autorisierte JavaScript-Quellen: `https://games.example.com`
   - Weiterleitungs-URIs: leer lassen (wird nicht gebraucht)
4. Die **Client-ID** kopieren (`…apps.googleusercontent.com`). Ein Client-Secret wird nicht benötigt.

### 2. DNS

A-Eintrag (und ggf. AAAA) für `games.example.com` auf die IP des Servers.

### 3. Verzeichnisse und Konfiguration auf dem Server

```bash
node -v    # muss 20.12 oder neuer sein
which rsync pm2

sudo mkdir -p /var/www/game-hub /var/lib/game-hub
sudo chown deploy:deploy /var/www/game-hub /var/lib/game-hub

# Konfiguration anlegen (Vorlage: server/deploy/env.example)
sudo -u deploy nano /var/lib/game-hub/.env
sudo chmod 600 /var/lib/game-hub/.env
```

Inhalt von `/var/lib/game-hub/.env`:

```
GOOGLE_CLIENT_ID=deine-client-id.apps.googleusercontent.com
PUBLIC_ORIGIN=https://games.example.com
PORT=3100
DB_FILE=/var/lib/game-hub/game-hub.db
```

`PORT` darf von nichts anderem auf dem Server belegt sein (prüfen mit `ss -ltnp | grep 3100`).

Die `.env` und die Datenbank liegen absichtlich **außerhalb** von `/var/www/game-hub`. Ein Deployment kann sie deshalb nie überschreiben.

### 4. nginx und HTTPS

Vorlage: `server/deploy/nginx.conf`. Domain und bei Bedarf den Port anpassen, dann:

```bash
sudo cp nginx.conf /etc/nginx/sites-available/game-hub
sudo ln -s /etc/nginx/sites-available/game-hub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d games.example.com
```

Certbot ergänzt den HTTPS-Block und die Weiterleitung von HTTP auf HTTPS selbst.

### 5. Deploy-Schlüssel für GitHub

Auf deinem Rechner:

```bash
ssh-keygen -t ed25519 -f game-hub-deploy -N "" -C "github-deploy game-hub"
ssh-keyscan -p 22 DEINE-SERVER-IP      # Ausgabe = DEPLOY_KNOWN_HOSTS
```

Den Inhalt von `game-hub-deploy.pub` auf dem Server in `~deploy/.ssh/authorized_keys` eintragen.

Im Repo unter **Settings → Secrets and variables → Actions**:

| Art | Name | Wert |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | Inhalt von `game-hub-deploy` (privater Schlüssel) |
| Secret | `DEPLOY_HOST` | Server-IP oder Hostname |
| Secret | `DEPLOY_USER` | `deploy` |
| Secret | `DEPLOY_KNOWN_HOSTS` | Ausgabe von `ssh-keyscan` |
| Secret | `DEPLOY_PORT` | nur falls SSH nicht auf Port 22 läuft |
| Variable | `DEPLOY_ENABLED` | `true` |

### 6. Erstes Deployment

**Actions → „Deploy to own server“ → Run workflow.** Danach deployt jeder Merge auf `main` automatisch:

1. Die Server-Tests laufen.
2. Die Dateien werden per rsync nach `/var/www/game-hub/` kopiert.
3. Auf dem Server laufen `npm ci` und `pm2 startOrReload`.

Falls pm2 bei dir noch nicht beim Booten startet: einmal `pm2 startup` ausführen (den ausgegebenen Befehl mit sudo ausführen), danach `pm2 save`.

Prüfen:

```bash
curl https://games.example.com/api/config     # {"googleClientId":"…","games":[…]}
pm2 logs game-hub
```

---

## Betrieb

- **Logs:** `pm2 logs game-hub`
- **Neustart:** `pm2 reload game-hub`
- **Backup der Datenbank** (z. B. täglich per cron; funktioniert auch im laufenden Betrieb):
  ```bash
  sqlite3 /var/lib/game-hub/game-hub.db ".backup '/var/backups/game-hub-$(date +%F).db'"
  ```
  Wenn `sqlite3` fehlt: `sudo apt install sqlite3`.
- **better-sqlite3** bringt für Linux x64 fertige Binärdateien mit. Falls `npm ci` trotzdem kompilieren will: `sudo apt install build-essential python3`.

## Datenschutz (Hinweise, keine Rechtsberatung)

- **Gespeichert werden:**
  - die Google-Konto-ID (eine anonyme Nummer)
  - der Spitzname
  - die Spielstände
  - ein Sitzungs-Cookie (`gh_session`, technisch notwendig, 90 Tage)
- **Tracking:** keines, und kein Cookie-Banner nötig, weil es keine Tracking-Cookies gibt.
- **Google:** Die Hub-Seite lädt im abgemeldeten Zustand das Google-Anmeldeskript (`accounts.google.com`). Das gehört in die Datenschutzerklärung.
- **Löschen:** Spieler können ihr Konto samt allen Cloud-Spielständen im Hub unter „Delete account“ selbst löschen.
- **Pflichtseiten:** Impressum und Datenschutzerklärung sind Pflicht, sobald die Seite öffentlich ist.

## Sync-Verhalten

- **Erstes Anmelden** auf einem Gerät mit Fortschritt und leerem Konto: Der Fortschritt wird hochgeladen.
- **Anderes Gerät hat neuer gespeichert:** Beim Öffnen des Spiels gewinnt die Cloud-Kopie. Nicht synchronisierte lokale Änderungen werden unter `cloud:backup:<spiel>` im Browser aufgehoben, nicht gelöscht.
- **Während des Spiels:** Alle 15 Sekunden und beim Verlassen der Seite werden Änderungen hochgeladen.
- **Server nicht erreichbar:** Das Spiel startet nach spätestens 2,5 Sekunden trotzdem, dann ohne Sync.

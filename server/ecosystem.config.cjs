// pm2 process file. Started (and restarted on every deploy) with
//   pm2 startOrReload ecosystem.config.cjs --update-env
// Settings live in the env file, not here: see docs/SERVER.md.
module.exports = {
  apps: [
    {
      name: "game-hub",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1, // SQLite has one writer; one process is plenty
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        ENV_FILE: process.env.GAME_HUB_ENV_FILE || "/var/lib/game-hub/.env",
      },
    },
  ],
};

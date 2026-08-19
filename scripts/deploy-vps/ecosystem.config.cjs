const path = require("node:path");

const root = path.resolve(__dirname, "../..");

module.exports = {
  apps: [
    {
      name: "opspanel-api",
      script: "dist/main.js",
      cwd: path.join(root, "apps/api"),
      instances: 1,
      exec_mode: "cluster",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 3000,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "opspanel-worker",
      script: "dist/index.js",
      cwd: path.join(root, "apps/worker"),
      instances: 1,
      exec_mode: "cluster",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 3000,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "opspanel-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: path.join(root, "apps/web"),
      instances: 1,
      exec_mode: "cluster",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "5s",
      restart_delay: 3000,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", PORT: "3000" },
    },
  ],
};

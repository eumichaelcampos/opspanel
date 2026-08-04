module.exports = {
  apps: [
    {
      name: "opspanel-api",
      script: "dist/main.js",
      cwd: "/root/opspanel/apps/api",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "opspanel-worker",
      script: "dist/index.js",
      cwd: "/root/opspanel/apps/worker",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "opspanel-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/root/opspanel/apps/web",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", PORT: "3000" },
    },
  ],
};

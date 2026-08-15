module.exports = {
  apps: [
    {
      name: 'dispozapi-api',
      cwd: '/opt/dispozapi/current',
      script: '/opt/dispozapi/current/deploy/start-api.sh',
      interpreter: '/bin/bash',
      autorestart: true,
      max_memory_restart: '700M',
      time: true,
    },
    {
      name: 'dispozapi-web',
      cwd: '/opt/dispozapi/current/apps/web',
      script: '/opt/dispozapi/current/apps/web/node_modules/next/dist/bin/next',
      args: 'start -p 3100 -H 0.0.0.0',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '700M',
      time: true,
    },
  ],
}


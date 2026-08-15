const fs = require('fs')

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
        return [key, value]
      }),
  )
}

const webEnv = readEnvFile('/opt/dispozapi/shared/web.env')

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
        ...webEnv,
      },
      autorestart: true,
      max_memory_restart: '700M',
      time: true,
    },
  ],
}

module.exports = {
  apps: [
    {
      name: process.env.PM2_BACKEND_APP_NAME || process.env.PM2_APP_NAME || 'telegram-whatsapp-bridge',
      cwd: __dirname,
      script: './src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || 3100
      }
    },
    {
      name: process.env.PM2_FRONTEND_APP_NAME || 'portal-afiliado-web',
      cwd: `${__dirname}/web`,
      script: 'npm',
      args: 'start -- -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 5000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: 3000
      }
    }
  ]
};

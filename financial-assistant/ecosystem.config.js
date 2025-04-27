module.exports = {
  apps: [
    {
      // Main API Server
      name: 'financial-assistant-api',
      script: './backend/src/app.js',
      instances: 'max', // Use max CPU cores
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      autorestart: true,
      max_memory_restart: '1G',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    },
    {
      // WhatsApp Bot
      name: 'financial-assistant-whatsapp',
      script: './backend/src/whatsapp.js',
      instances: 1, // Single instance for WhatsApp
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      autorestart: true,
      max_memory_restart: '1G',
      error_file: './logs/whatsapp-error.log',
      out_file: './logs/whatsapp-out.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    },
    {
      // System Monitor
      name: 'financial-assistant-monitor',
      script: './backend/src/scripts/monitor.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      cron_restart: '0 */6 * * *', // Restart every 6 hours
      autorestart: true,
      max_memory_restart: '500M',
      error_file: './logs/monitor-error.log',
      out_file: './logs/monitor-out.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    },
    {
      // Automated Backup
      name: 'financial-assistant-backup',
      script: './backend/src/scripts/backup.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      cron_restart: '0 0 * * *', // Run daily at midnight
      autorestart: false,
      error_file: './logs/backup-error.log',
      out_file: './logs/backup-out.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    },
    {
      // System Maintenance
      name: 'financial-assistant-maintenance',
      script: './backend/src/scripts/maintenance.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      cron_restart: '0 2 * * 0', // Run weekly on Sunday at 2 AM
      autorestart: false,
      error_file: './logs/maintenance-error.log',
      out_file: './logs/maintenance-out.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      log_type: 'json'
    }
  ],

  deploy: {
    production: {
      user: 'ubuntu',
      host: process.env.PRODUCTION_HOST || 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:yourusername/financial-assistant.git',
      path: '/var/www/financial-assistant',
      'post-deploy': [
        'npm install',
        'npm run build',
        'node ./backend/src/scripts/init-db.js',
        'pm2 reload ecosystem.config.js --env production'
      ].join(' && '),
      env: {
        NODE_ENV: 'production'
      }
    },
    staging: {
      user: 'ubuntu',
      host: process.env.STAGING_HOST || 'localhost',
      ref: 'origin/staging',
      repo: 'git@github.com:yourusername/financial-assistant.git',
      path: '/var/www/financial-assistant-staging',
      'post-deploy': [
        'npm install',
        'npm run build',
        'node ./backend/src/scripts/init-db.js',
        'pm2 reload ecosystem.config.js --env staging'
      ].join(' && '),
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};

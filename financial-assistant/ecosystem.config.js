module.exports = {
  apps: [{
    // Combined server (API + WhatsApp + Monitor)
    name: 'financial-assistant',
    script: './backend/src/app.js',
    instances: 1, // Single instance to minimize resource usage
    exec_mode: 'fork', // Fork mode uses less memory than cluster
    watch: false,
    node_args: [
      '--optimize-for-size',
      '--max-old-space-size=200', // Limit heap size to 200MB
      '--gc-interval=100'
    ],
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      
      // Resource limits
      MAX_MEMORY: '200M',
      MAX_FILE_SIZE: '1M',
      MAX_REQUEST_SIZE: '1M',
      MAX_CONCURRENT_OCR: '2',
      
      // Performance tuning
      MONGODB_POOL_SIZE: '5',
      MONGODB_MAX_IDLE_TIME_MS: '30000',
      CACHE_TTL: '3600',
      CACHE_MAX_ITEMS: '1000',
      
      // Rate limiting
      RATE_LIMIT_WINDOW: '900000', // 15 minutes
      RATE_LIMIT_MAX: '100',
      
      // Monitoring
      MONITOR_INTERVAL: '300000', // 5 minutes
      ALERT_THRESHOLD: '80',
      
      // Cleanup
      CLEANUP_INTERVAL: '86400000', // 24 hours
      LOG_RETENTION_DAYS: '7',
      MAX_LOG_SIZE: '10M'
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000,
      WATCH: true,
      LOG_LEVEL: 'debug'
    },

    // Resource management
    autorestart: true,
    max_restarts: 5,
    min_uptime: '5s',
    max_memory_restart: '200M',
    kill_timeout: 3000,
    
    // Logging (minimal to save disk space)
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    log_type: 'json',
    max_logs: '7d', // Keep logs for 7 days only

    // Maintenance tasks (combined into main process)
    cron_restart: '0 2 * * *', // Restart daily at 2 AM for cleanup
    
    // Metrics (disabled to save resources)
    metrics: false,
    
    // Source maps (disabled in production)
    source_map_support: false
  }]
  ],

  // Simplified deployment for minimal hosting
  deploy: {
    production: {
      user: 'ubuntu',
      host: process.env.PRODUCTION_HOST || 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:yourusername/financial-assistant.git',
      path: '/var/www/financial-assistant',
      'pre-deploy': 'npm prune --production', // Remove dev dependencies
      'post-deploy': [
        'npm ci --production', // Use clean install
        'npm run build',
        'node ./backend/src/scripts/init-db.js',
        'pm2 reload ecosystem.config.js --env production'
      ].join(' && '),
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};

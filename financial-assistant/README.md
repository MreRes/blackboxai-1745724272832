# Financial Assistant

A WhatsApp-based financial assistant with web dashboard for personal finance management.

## Minimal Hosting Requirements

- RAM: 512MB minimum (200MB allocated to Node.js)
- Storage: 1GB minimum
- CPU: 1 core
- Node.js: v14 or higher
- MongoDB: v4.4 or higher

## Optimized Setup

### Quick Start
```bash
# Start the application with optimized settings
./backend/src/scripts/start.sh
```

### Manual Setup

1. Set environment variables:
```bash
export NODE_OPTIONS="--max-old-space-size=200 --gc-interval=100"
export MAX_MEMORY="200M"
export MAX_FILE_SIZE="1M"
export MONGODB_POOL_SIZE="5"
```

2. Install production dependencies:
```bash
npm ci --production
```

3. Start with PM2:
```bash
pm2 start ecosystem.config.js --env production
```

## Resource Management

### Memory Optimization
- Node.js heap limited to 200MB
- Automatic garbage collection
- Memory usage monitoring
- Cache size limits
- File upload size restrictions

### Storage Optimization
- Automatic cleanup of old logs (7 days retention)
- Image compression for uploads
- Database archiving for old records
- Temporary file cleanup

### Performance Tuning
- Single process mode
- Connection pooling
- Response caching
- Rate limiting
- Automatic optimization scheduling

## Maintenance

### Automated Tasks
- Daily optimization at 2 AM
- Weekly database maintenance
- Log rotation
- Cache cleanup

### Manual Optimization
```bash
# Run optimization script
node backend/src/scripts/optimize.js
```

## Monitoring

### Resource Usage
```bash
# View process metrics
pm2 monit

# View logs
pm2 logs financial-assistant
```

### Health Checks
- Memory usage alerts
- CPU usage monitoring
- Storage space checks
- Database connection monitoring

## Features with Resource Considerations

1. OCR Processing
   - Limited to 2 concurrent processes
   - Max file size: 1MB
   - Automatic cleanup of processed files

2. WhatsApp Integration
   - Single instance mode
   - Message queue limit: 100
   - Daily message limit: 1000

3. Database Operations
   - Connection pool: 5 connections
   - Idle timeout: 30 seconds
   - Index optimization
   - Automatic archiving

4. Caching
   - Maximum items: 1000
   - TTL: 1 hour
   - Three-tier cache system
   - Automatic pruning

5. API Limits
   - Rate limit: 100 requests per 15 minutes
   - Response timeout: 10 seconds
   - Maximum payload size: 1MB

## Troubleshooting

### Common Issues

1. High Memory Usage
```bash
# Run manual optimization
node backend/src/scripts/optimize.js
```

2. Slow Response Times
```bash
# Check current connections
pm2 describe financial-assistant
```

3. Storage Issues
```bash
# Clean up old files
find ./logs -type f -mtime +7 -delete
```

### Performance Tips

1. Regular Maintenance
   - Run optimization script weekly
   - Monitor log sizes
   - Check database indexes

2. Resource Management
   - Keep file uploads small
   - Use pagination for large datasets
   - Implement client-side caching

3. Error Prevention
   - Monitor error rates
   - Check resource usage
   - Review application logs

## Support

For issues and support, please:
1. Check the logs in `./logs/`
2. Review resource usage with `pm2 monit`
3. Run optimization script if needed
4. Contact support if issues persist

## License

[Your License Here]

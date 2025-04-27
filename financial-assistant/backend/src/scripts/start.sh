#!/bin/bash

# Set Node.js memory limits
export NODE_OPTIONS="--max-old-space-size=200 --gc-interval=100"

# Set environment variables for resource limits
export MAX_MEMORY="200M"
export MAX_FILE_SIZE="1M"
export MAX_REQUEST_SIZE="1M"
export MAX_CONCURRENT_OCR="2"
export MONGODB_POOL_SIZE="5"
export MONGODB_MAX_IDLE_TIME_MS="30000"
export CACHE_TTL="3600"
export CACHE_MAX_ITEMS="1000"
export RATE_LIMIT_WINDOW="900000"
export RATE_LIMIT_MAX="100"

# Create required directories
mkdir -p logs uploads tmp

# Clean up old files
find ./logs -type f -mtime +7 -delete
find ./tmp -type f -mtime +1 -delete

# Run database optimization
echo "Running database optimization..."
node ./src/scripts/optimize.js

# Start the application with PM2
echo "Starting application..."
pm2 start ecosystem.config.js --env production

# Monitor application
echo "Setting up monitoring..."
pm2 monit &

# Watch resource usage
while true; do
    # Get memory usage
    memory=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')
    
    # Get disk usage
    disk=$(df -h / | awk 'NR==2{print $5}')
    
    # Get CPU usage
    cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    
    echo "Resource Usage - Memory: $memory, Disk: $disk, CPU: $cpu%"
    
    # Check if memory usage is above threshold (80%)
    if [ $(echo "$memory > 80" | bc) -eq 1 ]; then
        echo "High memory usage detected, running optimization..."
        node ./src/scripts/optimize.js
    fi
    
    # Sleep for 5 minutes
    sleep 300
done

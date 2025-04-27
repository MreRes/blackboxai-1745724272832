const os = require('os');
const limits = require('../config/limits');
const logger = require('./logger');

class SystemMonitor {
    constructor() {
        this.stats = {
            startTime: Date.now(),
            requests: 0,
            errors: 0,
            memoryUsage: {},
            cpuUsage: {},
            diskUsage: {},
            activeUsers: 0,
            processingTasks: 0
        };

        // Initialize monitoring
        this.initializeMonitoring();
    }

    initializeMonitoring() {
        // Monitor system resources periodically
        setInterval(() => this.checkResources(), limits.monitoring.checkInterval);
        
        // Reset daily stats at midnight
        setInterval(() => this.resetDailyStats(), 24 * 60 * 60 * 1000);
    }

    checkResources() {
        try {
            // Update memory stats
            const memUsage = process.memoryUsage();
            this.stats.memoryUsage = {
                heapUsed: memUsage.heapUsed / 1024 / 1024,
                heapTotal: memUsage.heapTotal / 1024 / 1024,
                rss: memUsage.rss / 1024 / 1024,
                external: memUsage.external / 1024 / 1024
            };

            // Update CPU stats
            const cpus = os.cpus();
            const cpuUsage = process.cpuUsage();
            this.stats.cpuUsage = {
                user: cpuUsage.user / 1000000,
                system: cpuUsage.system / 1000000,
                cores: cpus.length,
                load: os.loadavg()
            };

            // Check if resources are near limits
            this.checkResourceLimits();
        } catch (error) {
            logger.error('Resource monitoring error:', error);
        }
    }

    checkResourceLimits() {
        const memoryThreshold = limits.monitoring.alertThreshold;
        const heapUsedPercent = (this.stats.memoryUsage.heapUsed / this.stats.memoryUsage.heapTotal) * 100;

        if (heapUsedPercent > memoryThreshold) {
            logger.warn('High memory usage detected', {
                heapUsedPercent,
                memoryUsage: this.stats.memoryUsage
            });
            this.triggerMemoryCleanup();
        }

        if (this.stats.cpuUsage.load[0] > os.cpus().length * (memoryThreshold / 100)) {
            logger.warn('High CPU usage detected', {
                load: this.stats.cpuUsage.load,
                cpuUsage: this.stats.cpuUsage
            });
            this.throttleRequests();
        }
    }

    triggerMemoryCleanup() {
        if (global.gc) {
            try {
                global.gc();
                logger.info('Manual garbage collection triggered');
            } catch (error) {
                logger.error('Garbage collection failed:', error);
            }
        }
    }

    throttleRequests() {
        // Implement temporary rate limiting
        this.isThrottling = true;
        setTimeout(() => {
            this.isThrottling = false;
        }, 60000); // Throttle for 1 minute
    }

    resetDailyStats() {
        const dailyStats = {
            date: new Date().toISOString().split('T')[0],
            requests: this.stats.requests,
            errors: this.stats.errors,
            uniqueUsers: this.stats.activeUsers,
            avgMemoryUsage: this.stats.memoryUsage,
            avgCpuUsage: this.stats.cpuUsage
        };

        // Log daily stats
        logger.info('Daily statistics:', dailyStats);

        // Reset counters
        this.stats.requests = 0;
        this.stats.errors = 0;
        this.stats.activeUsers = 0;
    }

    // Middleware to track requests
    middleware() {
        return (req, res, next) => {
            if (this.isThrottling) {
                return res.status(429).json({
                    success: false,
                    error: 'Server is currently experiencing high load. Please try again later.'
                });
            }

            this.stats.requests++;
            if (req.user) {
                this.stats.activeUsers = Math.max(this.stats.activeUsers, 
                    Object.keys(req.app.locals.activeSessions || {}).length);
            }

            // Track response time
            const start = process.hrtime();
            res.on('finish', () => {
                const [seconds, nanoseconds] = process.hrtime(start);
                const responseTime = seconds * 1000 + nanoseconds / 1000000;

                if (res.statusCode >= 400) {
                    this.stats.errors++;
                }

                // Log slow responses
                if (responseTime > limits.api.timeout) {
                    logger.warn('Slow response detected', {
                        path: req.path,
                        method: req.method,
                        responseTime,
                        statusCode: res.statusCode
                    });
                }
            });

            next();
        };
    }

    getStats() {
        return {
            ...this.stats,
            uptime: process.uptime(),
            errorRate: this.stats.requests ? (this.stats.errors / this.stats.requests) * 100 : 0,
            isThrottling: this.isThrottling || false
        };
    }
}

module.exports = new SystemMonitor();

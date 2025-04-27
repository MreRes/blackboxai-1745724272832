const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const logger = require('./logger');
const errorHandler = require('./errorHandler');

class RateLimiter {
    constructor() {
        // Initialize Redis client
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            keyPrefix: 'ratelimit:'
        });

        // Default configurations
        this.defaults = {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            message: {
                success: false,
                message: 'Terlalu banyak permintaan, silakan coba lagi nanti.'
            },
            standardHeaders: true,
            legacyHeaders: false
        };

        // Predefined limiters
        this.limiters = {
            // API rate limiter
            api: this.createLimiter({
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: 100 // 100 requests per 15 minutes
            }),

            // Auth rate limiter (more strict)
            auth: this.createLimiter({
                windowMs: 60 * 60 * 1000, // 1 hour
                max: 5, // 5 attempts per hour
                message: {
                    success: false,
                    message: 'Terlalu banyak percobaan login, silakan coba lagi nanti.'
                }
            }),

            // WhatsApp rate limiter
            whatsapp: this.createLimiter({
                windowMs: 60 * 1000, // 1 minute
                max: 20 // 20 messages per minute
            }),

            // File upload rate limiter
            upload: this.createLimiter({
                windowMs: 60 * 60 * 1000, // 1 hour
                max: 50 // 50 uploads per hour
            })
        };

        // Initialize stores
        this.initializeStores();
    }

    // Initialize Redis stores for different limiters
    initializeStores() {
        try {
            Object.keys(this.limiters).forEach(key => {
                this.limiters[key].store = new RedisStore({
                    client: this.redis,
                    prefix: `ratelimit:${key}:`
                });
            });
        } catch (error) {
            logger.error(error, { type: 'rate_limiter_store_init_error' });
            // Fallback to memory store
            logger.info('Falling back to memory store for rate limiting');
        }
    }

    // Create a new rate limiter
    createLimiter(options = {}) {
        const config = {
            ...this.defaults,
            ...options,
            handler: (req, res, next) => this.handleRateLimit(req, res, next, options)
        };

        return rateLimit(config);
    }

    // Handle rate limit exceeded
    handleRateLimit(req, res, next, options) {
        const error = errorHandler.rateLimitError(
            options.message?.message || this.defaults.message.message
        );

        // Log rate limit event
        logger.warn('Rate limit exceeded', {
            ip: req.ip,
            path: req.path,
            headers: req.headers
        });

        // Return error response
        res.status(429).json({
            success: false,
            error: {
                type: 'RATE_LIMIT_ERROR',
                message: error.message,
                retryAfter: Math.ceil(options.windowMs / 1000) // seconds
            }
        });
    }

    // Get API rate limiter
    getApiLimiter() {
        return this.limiters.api;
    }

    // Get Auth rate limiter
    getAuthLimiter() {
        return this.limiters.auth;
    }

    // Get WhatsApp rate limiter
    getWhatsAppLimiter() {
        return this.limiters.whatsapp;
    }

    // Get Upload rate limiter
    getUploadLimiter() {
        return this.limiters.upload;
    }

    // Create a user-specific rate limiter
    createUserLimiter(userId, options = {}) {
        return this.createLimiter({
            ...options,
            keyGenerator: (req) => `user:${userId}:${req.ip}`,
            skipFailedRequests: false
        });
    }

    // Create a route-specific rate limiter
    createRouteLimiter(route, options = {}) {
        return this.createLimiter({
            ...options,
            keyGenerator: (req) => `route:${route}:${req.ip}`
        });
    }

    // Dynamic rate limiter based on user type
    getDynamicLimiter() {
        return (req, res, next) => {
            const user = req.user;
            let limiter;

            if (!user) {
                // Use strict limits for unauthenticated requests
                limiter = this.createLimiter({
                    windowMs: 15 * 60 * 1000,
                    max: 30
                });
            } else if (user.isAdmin) {
                // Higher limits for admin users
                limiter = this.createLimiter({
                    windowMs: 15 * 60 * 1000,
                    max: 1000
                });
            } else {
                // Normal limits for authenticated users
                limiter = this.createLimiter({
                    windowMs: 15 * 60 * 1000,
                    max: 100
                });
            }

            return limiter(req, res, next);
        };
    }

    // Check current rate limit status
    async getRateLimitStatus(key) {
        try {
            const consumed = await this.redis.get(`ratelimit:${key}`);
            const ttl = await this.redis.ttl(`ratelimit:${key}`);

            return {
                consumed: parseInt(consumed) || 0,
                remaining: Math.max(0, this.defaults.max - (parseInt(consumed) || 0)),
                reset: new Date(Date.now() + (ttl * 1000)),
                limit: this.defaults.max
            };
        } catch (error) {
            logger.error(error, { type: 'rate_limit_status_error', key });
            return null;
        }
    }

    // Reset rate limit for a specific key
    async resetRateLimit(key) {
        try {
            await this.redis.del(`ratelimit:${key}`);
            return true;
        } catch (error) {
            logger.error(error, { type: 'rate_limit_reset_error', key });
            return false;
        }
    }

    // Middleware to add rate limit info to response headers
    addRateLimitHeaders() {
        return async (req, res, next) => {
            try {
                const key = req.ip;
                const status = await this.getRateLimitStatus(key);

                if (status) {
                    res.setHeader('X-RateLimit-Limit', status.limit);
                    res.setHeader('X-RateLimit-Remaining', status.remaining);
                    res.setHeader('X-RateLimit-Reset', status.reset.getTime());
                }
            } catch (error) {
                logger.error(error, { type: 'rate_limit_headers_error' });
            }

            next();
        };
    }

    // Clean up expired rate limit data
    async cleanup() {
        try {
            const keys = await this.redis.keys('ratelimit:*');
            let cleaned = 0;

            for (const key of keys) {
                const ttl = await this.redis.ttl(key);
                if (ttl <= 0) {
                    await this.redis.del(key);
                    cleaned++;
                }
            }

            logger.info(`Rate limit cleanup completed`, { cleaned });
            return cleaned;
        } catch (error) {
            logger.error(error, { type: 'rate_limit_cleanup_error' });
            return 0;
        }
    }

    // Get rate limit statistics
    async getStatistics() {
        try {
            const keys = await this.redis.keys('ratelimit:*');
            const stats = {
                total: keys.length,
                active: 0,
                blocked: 0,
                types: {}
            };

            for (const key of keys) {
                const consumed = await this.redis.get(key);
                const type = key.split(':')[1];

                if (!stats.types[type]) {
                    stats.types[type] = {
                        total: 0,
                        blocked: 0
                    };
                }

                stats.types[type].total++;
                
                if (parseInt(consumed) >= this.defaults.max) {
                    stats.blocked++;
                    stats.types[type].blocked++;
                } else {
                    stats.active++;
                }
            }

            return stats;
        } catch (error) {
            logger.error(error, { type: 'rate_limit_stats_error' });
            return null;
        }
    }
}

module.exports = new RateLimiter();

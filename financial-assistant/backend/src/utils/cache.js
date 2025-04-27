const NodeCache = require('node-cache');
const logger = require('./logger');

class CacheManager {
    constructor() {
        // Initialize caches with different TTLs
        const limits = require('../config/limits');

        this.shortTermCache = new NodeCache({
            stdTTL: Math.min(300, limits.cache.ttl), // 5 minutes or configured TTL
            checkperiod: 60,
            maxKeys: Math.floor(limits.cache.maxItems / 3), // Distribute max items across caches
            useClones: false
        });

        this.mediumTermCache = new NodeCache({
            stdTTL: Math.min(3600, limits.cache.ttl * 2), // 1 hour or 2x configured TTL
            checkperiod: Math.min(300, limits.cache.checkPeriod),
            maxKeys: Math.floor(limits.cache.maxItems / 3),
            useClones: false
        });

        this.longTermCache = new NodeCache({
            stdTTL: Math.min(86400, limits.cache.ttl * 4), // 24 hours or 4x configured TTL
            checkperiod: Math.min(3600, limits.cache.checkPeriod * 2),
            maxKeys: Math.floor(limits.cache.maxItems / 3),
            useClones: false
        });

        // Cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            keys: 0
        };

        // Initialize cache event listeners
        this.initializeEventListeners();
    }

    // Initialize event listeners for cache statistics
    initializeEventListeners() {
        [this.shortTermCache, this.mediumTermCache, this.longTermCache].forEach(cache => {
            cache.on('set', () => {
                this.stats.keys = this.getTotalKeys();
            });

            cache.on('del', () => {
                this.stats.keys = this.getTotalKeys();
            });

            cache.on('expired', (key, value) => {
                logger.debug('Cache key expired', { key });
                this.stats.keys = this.getTotalKeys();
            });

            cache.on('flush', () => {
                this.stats.keys = this.getTotalKeys();
            });
        });
    }

    // Get the appropriate cache based on TTL
    getCache(ttl) {
        if (ttl <= 300) return this.shortTermCache;
        if (ttl <= 3600) return this.mediumTermCache;
        return this.longTermCache;
    }

    // Generate cache key
    generateKey(prefix, params) {
        if (typeof params === 'string') return `${prefix}:${params}`;
        return `${prefix}:${JSON.stringify(params)}`;
    }

    // Set value in cache
    set(key, value, ttl = 300) {
        try {
            const cache = this.getCache(ttl);
            return cache.set(key, value, ttl);
        } catch (error) {
            logger.error(error, { type: 'cache_set_error', key });
            return false;
        }
    }

    // Get value from cache
    get(key) {
        try {
            // Try each cache in order
            for (const cache of [this.shortTermCache, this.mediumTermCache, this.longTermCache]) {
                const value = cache.get(key);
                if (value !== undefined) {
                    this.stats.hits++;
                    return value;
                }
            }
            this.stats.misses++;
            return undefined;
        } catch (error) {
            logger.error(error, { type: 'cache_get_error', key });
            return undefined;
        }
    }

    // Delete value from all caches
    del(key) {
        try {
            [this.shortTermCache, this.mediumTermCache, this.longTermCache].forEach(cache => {
                cache.del(key);
            });
            return true;
        } catch (error) {
            logger.error(error, { type: 'cache_del_error', key });
            return false;
        }
    }

    // Clear all caches
    flush() {
        try {
            [this.shortTermCache, this.mediumTermCache, this.longTermCache].forEach(cache => {
                cache.flushAll();
            });
            return true;
        } catch (error) {
            logger.error(error, { type: 'cache_flush_error' });
            return false;
        }
    }

    // Get total number of cached keys
    getTotalKeys() {
        return this.shortTermCache.keys().length +
               this.mediumTermCache.keys().length +
               this.longTermCache.keys().length;
    }

    // Get cache statistics
    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            shortTerm: {
                keys: this.shortTermCache.keys().length,
                stats: this.shortTermCache.getStats()
            },
            mediumTerm: {
                keys: this.mediumTermCache.keys().length,
                stats: this.mediumTermCache.getStats()
            },
            longTerm: {
                keys: this.longTermCache.keys().length,
                stats: this.longTermCache.getStats()
            }
        };
    }

    // Cache middleware for Express routes with resource limits
    middleware(duration = limits.cache.ttl) {
        return (req, res, next) => {
            // Skip caching for non-GET requests
            if (req.method !== 'GET') return next();

            // Skip caching for authenticated routes if user is not verified
            if (req.user && !req.user.isVerified) {
                return next();
            }

            // Generate cache key from URL, query parameters, and user role
            const key = this.generateKey('route', {
                url: req.originalUrl || req.url,
                query: req.query,
                user: req.user ? {
                    id: req.user._id,
                    role: req.user.role
                } : 'anonymous'
            });

            // Check if we've reached the cache limit
            if (this.getTotalKeys() >= limits.cache.maxItems) {
                this.maintenance(); // Run maintenance to clear space
            }

            // Try to get from cache
            const cachedResponse = this.get(key);
            if (cachedResponse) {
                return res.json(cachedResponse);
            }

            // Store original json method
            const originalJson = res.json;

            // Override json method to cache the response
            res.json = (body) => {
                // Restore original json method
                res.json = originalJson;

                // Cache the response
                this.set(key, body, duration);

                // Send the response
                return res.json(body);
            };

            next();
        };
    }

    // Cached function decorator
    cached(fn, options = {}) {
        const {
            ttl = 300,
            prefix = 'fn',
            keyGenerator = (...args) => JSON.stringify(args)
        } = options;

        return async (...args) => {
            const key = this.generateKey(prefix, keyGenerator(...args));
            
            // Try to get from cache
            const cachedResult = this.get(key);
            if (cachedResult !== undefined) {
                return cachedResult;
            }

            // Execute function and cache result
            const result = await fn(...args);
            this.set(key, result, ttl);
            return result;
        };
    }

    // Bulk operations
    mset(items, ttl = 300) {
        try {
            const cache = this.getCache(ttl);
            return cache.mset(items.map(item => ({
                key: item.key,
                val: item.value,
                ttl
            })));
        } catch (error) {
            logger.error(error, { type: 'cache_mset_error' });
            return false;
        }
    }

    mget(keys) {
        try {
            const results = {};
            keys.forEach(key => {
                const value = this.get(key);
                if (value !== undefined) {
                    results[key] = value;
                }
            });
            return results;
        } catch (error) {
            logger.error(error, { type: 'cache_mget_error' });
            return {};
        }
    }

    // Cache warming
    async warmUp(items) {
        try {
            const operations = items.map(async item => {
                const { key, generator, ttl = 300 } = item;
                if (!this.get(key)) {
                    const value = await generator();
                    this.set(key, value, ttl);
                }
            });

            await Promise.all(operations);
            return true;
        } catch (error) {
            logger.error(error, { type: 'cache_warmup_error' });
            return false;
        }
    }

    // Cache maintenance
    async maintenance() {
        try {
            // Get all keys
            const keys = [
                ...this.shortTermCache.keys(),
                ...this.mediumTermCache.keys(),
                ...this.longTermCache.keys()
            ];

            // Check TTL for each key
            const expiredKeys = keys.filter(key => {
                const ttl = this.shortTermCache.getTtl(key) ||
                           this.mediumTermCache.getTtl(key) ||
                           this.longTermCache.getTtl(key);
                return ttl && ttl < Date.now();
            });

            // Delete expired keys
            expiredKeys.forEach(key => this.del(key));

            // Log maintenance results
            logger.info('Cache maintenance completed', {
                totalKeys: keys.length,
                expiredKeys: expiredKeys.length
            });

            return {
                success: true,
                totalKeys: keys.length,
                expiredKeys: expiredKeys.length
            };
        } catch (error) {
            logger.error(error, { type: 'cache_maintenance_error' });
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new CacheManager();

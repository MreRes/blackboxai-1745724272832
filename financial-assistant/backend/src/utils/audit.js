const mongoose = require('mongoose');
const logger = require('./logger');
const formatter = require('./formatter');
const cache = require('./cache');

class AuditLogger {
    constructor() {
        // Define audit event types
        this.eventTypes = {
            // User events
            USER_CREATE: 'user.create',
            USER_UPDATE: 'user.update',
            USER_DELETE: 'user.delete',
            USER_LOGIN: 'user.login',
            USER_LOGOUT: 'user.logout',
            USER_ACTIVATE: 'user.activate',
            USER_DEACTIVATE: 'user.deactivate',

            // Transaction events
            TRANSACTION_CREATE: 'transaction.create',
            TRANSACTION_UPDATE: 'transaction.update',
            TRANSACTION_DELETE: 'transaction.delete',

            // Budget events
            BUDGET_CREATE: 'budget.create',
            BUDGET_UPDATE: 'budget.update',
            BUDGET_DELETE: 'budget.delete',

            // WhatsApp events
            WHATSAPP_CONNECT: 'whatsapp.connect',
            WHATSAPP_DISCONNECT: 'whatsapp.disconnect',
            WHATSAPP_MESSAGE: 'whatsapp.message',

            // System events
            SYSTEM_BACKUP: 'system.backup',
            SYSTEM_RESTORE: 'system.restore',
            SYSTEM_MAINTENANCE: 'system.maintenance',
            SYSTEM_ERROR: 'system.error',

            // Admin events
            ADMIN_LOGIN: 'admin.login',
            ADMIN_ACTION: 'admin.action',
            ADMIN_SETTINGS: 'admin.settings'
        };

        // Define severity levels
        this.severityLevels = {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
            CRITICAL: 'critical'
        };
    }

    // Log audit event
    async log(eventType, data, options = {}) {
        try {
            const {
                user = null,
                severity = this.severityLevels.INFO,
                ip = null,
                userAgent = null,
                metadata = {}
            } = options;

            const auditEntry = {
                timestamp: new Date(),
                eventType,
                severity,
                user: user ? {
                    id: user._id,
                    username: user.username,
                    isAdmin: user.isAdmin
                } : null,
                data: this.sanitizeData(data),
                metadata: {
                    ...metadata,
                    ip,
                    userAgent
                }
            };

            // Save to database
            await mongoose.connection.collection('audit_logs').insertOne(auditEntry);

            // Log to application logger
            logger.info('Audit event logged', {
                eventType,
                severity,
                userId: user?._id
            });

            // Cache recent events
            await this.cacheRecentEvent(auditEntry);

            return auditEntry;
        } catch (error) {
            logger.error(error, { type: 'audit_log_error', eventType });
            throw error;
        }
    }

    // Sanitize sensitive data
    sanitizeData(data) {
        const sensitiveFields = [
            'password',
            'token',
            'activationCode',
            'secret',
            'phoneNumber'
        ];

        const sanitized = JSON.parse(JSON.stringify(data));

        const sanitizeObject = (obj) => {
            for (const key in obj) {
                if (sensitiveFields.includes(key)) {
                    obj[key] = '[REDACTED]';
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObject(obj[key]);
                }
            }
        };

        sanitizeObject(sanitized);
        return sanitized;
    }

    // Cache recent events
    async cacheRecentEvent(event) {
        const cacheKey = 'recent_audit_events';
        const maxEvents = 100;

        try {
            let recentEvents = await cache.get(cacheKey) || [];
            recentEvents.unshift(event);
            recentEvents = recentEvents.slice(0, maxEvents);
            await cache.set(cacheKey, recentEvents, 3600); // Cache for 1 hour
        } catch (error) {
            logger.error(error, { type: 'audit_cache_error' });
        }
    }

    // Get recent events
    async getRecentEvents(limit = 100) {
        try {
            // Try cache first
            const cachedEvents = await cache.get('recent_audit_events');
            if (cachedEvents) {
                return cachedEvents.slice(0, limit);
            }

            // Fallback to database
            const events = await mongoose.connection.collection('audit_logs')
                .find({})
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();

            return events;
        } catch (error) {
            logger.error(error, { type: 'get_recent_events_error' });
            throw error;
        }
    }

    // Search audit logs
    async searchLogs(query = {}) {
        try {
            const {
                startDate,
                endDate,
                eventType,
                severity,
                userId,
                search,
                page = 1,
                limit = 50
            } = query;

            const filter = {};

            // Date range
            if (startDate || endDate) {
                filter.timestamp = {};
                if (startDate) filter.timestamp.$gte = new Date(startDate);
                if (endDate) filter.timestamp.$lte = new Date(endDate);
            }

            // Event type
            if (eventType) {
                filter.eventType = eventType;
            }

            // Severity
            if (severity) {
                filter.severity = severity;
            }

            // User ID
            if (userId) {
                filter['user.id'] = mongoose.Types.ObjectId(userId);
            }

            // Text search
            if (search) {
                filter.$or = [
                    { 'user.username': { $regex: search, $options: 'i' } },
                    { 'metadata.ip': { $regex: search, $options: 'i' } },
                    { 'data.description': { $regex: search, $options: 'i' } }
                ];
            }

            const skip = (page - 1) * limit;

            const [logs, total] = await Promise.all([
                mongoose.connection.collection('audit_logs')
                    .find(filter)
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray(),
                mongoose.connection.collection('audit_logs')
                    .countDocuments(filter)
            ]);

            return {
                logs,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(error, { type: 'search_audit_logs_error' });
            throw error;
        }
    }

    // Get audit statistics
    async getStatistics(period = 'day') {
        try {
            const startDate = new Date();
            switch (period) {
                case 'day':
                    startDate.setDate(startDate.getDate() - 1);
                    break;
                case 'week':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(startDate.getMonth() - 1);
                    break;
                default:
                    throw new Error('Invalid period');
            }

            const stats = await mongoose.connection.collection('audit_logs').aggregate([
                {
                    $match: {
                        timestamp: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalEvents: { $sum: 1 },
                        eventTypes: { $addToSet: '$eventType' },
                        uniqueUsers: { $addToSet: '$user.id' },
                        severityCounts: {
                            $push: '$severity'
                        }
                    }
                }
            ]).toArray();

            if (stats.length === 0) {
                return {
                    totalEvents: 0,
                    uniqueUsers: 0,
                    eventTypes: [],
                    severityCounts: {}
                };
            }

            const severityCounts = stats[0].severityCounts.reduce((acc, severity) => {
                acc[severity] = (acc[severity] || 0) + 1;
                return acc;
            }, {});

            return {
                totalEvents: stats[0].totalEvents,
                uniqueUsers: stats[0].uniqueUsers.length,
                eventTypes: stats[0].eventTypes,
                severityCounts
            };
        } catch (error) {
            logger.error(error, { type: 'audit_statistics_error' });
            throw error;
        }
    }

    // Create Express middleware for audit logging
    middleware(options = {}) {
        return async (req, res, next) => {
            const startTime = Date.now();

            // Store original end function
            const originalEnd = res.end;

            // Override end function
            res.end = async function(...args) {
                // Restore original end function
                res.end = originalEnd;

                // Calculate response time
                const responseTime = Date.now() - startTime;

                try {
                    // Log audit event
                    await this.log(
                        options.eventType || `http.${req.method.toLowerCase()}`,
                        {
                            path: req.path,
                            method: req.method,
                            query: req.query,
                            body: req.body,
                            statusCode: res.statusCode,
                            responseTime
                        },
                        {
                            user: req.user,
                            ip: req.ip,
                            userAgent: req.get('user-agent'),
                            metadata: {
                                ...options.metadata,
                                responseTime
                            }
                        }
                    );
                } catch (error) {
                    logger.error(error, { type: 'audit_middleware_error' });
                }

                // Call original end function
                return originalEnd.apply(res, args);
            };

            next();
        };
    }
}

module.exports = new AuditLogger();

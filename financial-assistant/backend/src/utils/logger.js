const winston = require('winston');
const path = require('path');
const fs = require('fs');
require('winston-daily-rotate-file');

class Logger {
    constructor() {
        this.logDir = process.env.LOG_PATH || 'logs';
        this.errorLogPath = path.join(this.logDir, 'error');
        this.accessLogPath = path.join(this.logDir, 'access');
        this.whatsappLogPath = path.join(this.logDir, 'whatsapp');

        // Create log directories if they don't exist
        [this.logDir, this.errorLogPath, this.accessLogPath, this.whatsappLogPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Define log format
        this.logFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.splat(),
            winston.format.json()
        );

        // Initialize loggers
        this.initializeLoggers();
    }

    initializeLoggers() {
        // Error logger
        this.errorLogger = winston.createLogger({
            level: 'error',
            format: this.logFormat,
            transports: [
                new winston.transports.DailyRotateFile({
                    filename: path.join(this.errorLogPath, 'error-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '20m',
                    maxFiles: '14d'
                })
            ]
        });

        // Access logger
        this.accessLogger = winston.createLogger({
            format: this.logFormat,
            transports: [
                new winston.transports.DailyRotateFile({
                    filename: path.join(this.accessLogPath, 'access-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '20m',
                    maxFiles: '14d'
                })
            ]
        });

        // WhatsApp logger
        this.whatsappLogger = winston.createLogger({
            format: this.logFormat,
            transports: [
                new winston.transports.DailyRotateFile({
                    filename: path.join(this.whatsappLogPath, 'whatsapp-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '20m',
                    maxFiles: '14d'
                })
            ]
        });

        // Add console transport in development
        if (process.env.NODE_ENV !== 'production') {
            const consoleFormat = winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            );

            [this.errorLogger, this.accessLogger, this.whatsappLogger].forEach(logger => {
                logger.add(new winston.transports.Console({
                    format: consoleFormat
                }));
            });
        }
    }

    // Log error with context
    error(error, context = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code
            },
            context: {
                ...context,
                environment: process.env.NODE_ENV,
                processId: process.pid
            }
        };

        this.errorLogger.error(logEntry);

        // Send critical errors to admin (if configured)
        if (this.isCriticalError(error) && process.env.ADMIN_EMAIL) {
            this.notifyAdmin(logEntry);
        }

        return logEntry;
    }

    // Log API access
    access(req, res, responseTime) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            responseTime,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            user: req.user ? req.user._id : null
        };

        this.accessLogger.info(logEntry);
        return logEntry;
    }

    // Log WhatsApp events
    whatsapp(event, data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            event,
            data
        };

        this.whatsappLogger.info(logEntry);
        return logEntry;
    }

    // Create Express middleware for access logging
    accessLogMiddleware() {
        return (req, res, next) => {
            const start = Date.now();

            // Log after response
            res.on('finish', () => {
                const responseTime = Date.now() - start;
                this.access(req, res, responseTime);
            });

            next();
        };
    }

    // Create Express error handling middleware
    errorHandlingMiddleware() {
        return (err, req, res, next) => {
            const logEntry = this.error(err, {
                method: req.method,
                url: req.originalUrl,
                user: req.user ? req.user._id : null
            });

            // Send error response
            res.status(err.status || 500).json({
                success: false,
                message: process.env.NODE_ENV === 'production' 
                    ? 'Internal server error' 
                    : err.message,
                errorId: logEntry.timestamp // For reference in logs
            });
        };
    }

    // Check if error is critical
    isCriticalError(error) {
        const criticalErrors = [
            'ECONNREFUSED', // Database connection failed
            'PROTOCOL_CONNECTION_LOST', // Database connection lost
            'ENOSPC', // No space left on device
            'ETIMEDOUT', // Operation timed out
        ];

        return criticalErrors.includes(error.code) ||
            error.message.includes('Critical') ||
            error.fatal === true;
    }

    // Notify admin about critical errors
    async notifyAdmin(logEntry) {
        try {
            // If email configuration exists
            if (process.env.SMTP_HOST) {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: process.env.SMTP_PORT,
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                });

                await transporter.sendMail({
                    from: process.env.SMTP_FROM,
                    to: process.env.ADMIN_EMAIL,
                    subject: `[CRITICAL] Error in Financial Assistant - ${logEntry.error.code || 'Unknown'}`,
                    text: JSON.stringify(logEntry, null, 2)
                });
            }

            // If webhook configuration exists
            if (process.env.WEBHOOK_URL) {
                await fetch(process.env.WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(logEntry)
                });
            }
        } catch (error) {
            console.error('Failed to notify admin:', error);
        }
    }

    // Get log statistics
    async getStats(days = 7) {
        const stats = {
            errors: 0,
            requests: 0,
            whatsappEvents: 0,
            topErrors: [],
            topEndpoints: [],
            responseTimeAvg: 0
        };

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Process error logs
            const errorLogs = await this.processLogs(this.errorLogPath, startDate);
            stats.errors = errorLogs.length;
            stats.topErrors = this.getTopErrors(errorLogs);

            // Process access logs
            const accessLogs = await this.processLogs(this.accessLogPath, startDate);
            stats.requests = accessLogs.length;
            stats.topEndpoints = this.getTopEndpoints(accessLogs);
            stats.responseTimeAvg = this.calculateAverageResponseTime(accessLogs);

            // Process WhatsApp logs
            const whatsappLogs = await this.processLogs(this.whatsappLogPath, startDate);
            stats.whatsappEvents = whatsappLogs.length;

        } catch (error) {
            console.error('Error getting log stats:', error);
        }

        return stats;
    }

    // Process log files
    async processLogs(logPath, startDate) {
        const logs = [];
        const files = await fs.promises.readdir(logPath);

        for (const file of files) {
            if (!file.endsWith('.log')) continue;

            const content = await fs.promises.readFile(path.join(logPath, file), 'utf8');
            const lines = content.split('\n').filter(line => line);

            for (const line of lines) {
                try {
                    const log = JSON.parse(line);
                    if (new Date(log.timestamp) >= startDate) {
                        logs.push(log);
                    }
                } catch (error) {
                    console.error('Error parsing log line:', error);
                }
            }
        }

        return logs;
    }

    // Get most common errors
    getTopErrors(logs) {
        const errorCounts = {};
        logs.forEach(log => {
            const message = log.error.message;
            errorCounts[message] = (errorCounts[message] || 0) + 1;
        });

        return Object.entries(errorCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([message, count]) => ({ message, count }));
    }

    // Get most accessed endpoints
    getTopEndpoints(logs) {
        const endpointCounts = {};
        logs.forEach(log => {
            const endpoint = log.url;
            endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
        });

        return Object.entries(endpointCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([endpoint, count]) => ({ endpoint, count }));
    }

    // Calculate average response time
    calculateAverageResponseTime(logs) {
        if (logs.length === 0) return 0;
        const total = logs.reduce((sum, log) => sum + log.responseTime, 0);
        return total / logs.length;
    }
}

// Export singleton instance
module.exports = new Logger();

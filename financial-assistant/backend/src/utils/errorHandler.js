const logger = require('./logger');
const notifier = require('./notifier');

class ErrorHandler {
    constructor() {
        // Error types
        this.errorTypes = {
            VALIDATION_ERROR: 'ValidationError',
            AUTHENTICATION_ERROR: 'AuthenticationError',
            AUTHORIZATION_ERROR: 'AuthorizationError',
            NOT_FOUND_ERROR: 'NotFoundError',
            DATABASE_ERROR: 'DatabaseError',
            WHATSAPP_ERROR: 'WhatsAppError',
            FILE_ERROR: 'FileError',
            RATE_LIMIT_ERROR: 'RateLimitError',
            SYSTEM_ERROR: 'SystemError'
        };

        // HTTP status codes
        this.statusCodes = {
            [this.errorTypes.VALIDATION_ERROR]: 400,
            [this.errorTypes.AUTHENTICATION_ERROR]: 401,
            [this.errorTypes.AUTHORIZATION_ERROR]: 403,
            [this.errorTypes.NOT_FOUND_ERROR]: 404,
            [this.errorTypes.DATABASE_ERROR]: 500,
            [this.errorTypes.WHATSAPP_ERROR]: 500,
            [this.errorTypes.FILE_ERROR]: 500,
            [this.errorTypes.RATE_LIMIT_ERROR]: 429,
            [this.errorTypes.SYSTEM_ERROR]: 500
        };

        // Error messages (Indonesian)
        this.errorMessages = {
            [this.errorTypes.VALIDATION_ERROR]: 'Data yang diberikan tidak valid',
            [this.errorTypes.AUTHENTICATION_ERROR]: 'Autentikasi gagal',
            [this.errorTypes.AUTHORIZATION_ERROR]: 'Anda tidak memiliki akses',
            [this.errorTypes.NOT_FOUND_ERROR]: 'Data tidak ditemukan',
            [this.errorTypes.DATABASE_ERROR]: 'Terjadi kesalahan pada database',
            [this.errorTypes.WHATSAPP_ERROR]: 'Terjadi kesalahan pada WhatsApp',
            [this.errorTypes.FILE_ERROR]: 'Terjadi kesalahan pada file',
            [this.errorTypes.RATE_LIMIT_ERROR]: 'Terlalu banyak permintaan',
            [this.errorTypes.SYSTEM_ERROR]: 'Terjadi kesalahan sistem'
        };
    }

    // Create custom error
    createError(type, message, details = null) {
        const error = new Error(message || this.errorMessages[type]);
        error.type = type;
        error.status = this.statusCodes[type];
        if (details) error.details = details;
        return error;
    }

    // Handle errors in async functions
    async handleAsync(promise) {
        try {
            const data = await promise;
            return [null, data];
        } catch (error) {
            return [this.normalizeError(error), null];
        }
    }

    // Normalize error object
    normalizeError(error) {
        // If already normalized, return as is
        if (error.type && error.status) return error;

        // Normalize mongoose validation errors
        if (error.name === 'ValidationError') {
            return this.createError(
                this.errorTypes.VALIDATION_ERROR,
                'Validasi gagal',
                Object.values(error.errors).map(err => err.message)
            );
        }

        // Normalize mongoose duplicate key errors
        if (error.code === 11000) {
            return this.createError(
                this.errorTypes.VALIDATION_ERROR,
                'Data sudah ada',
                Object.keys(error.keyPattern)
            );
        }

        // Normalize JWT errors
        if (error.name === 'JsonWebTokenError') {
            return this.createError(
                this.errorTypes.AUTHENTICATION_ERROR,
                'Token tidak valid'
            );
        }

        // Normalize multer errors
        if (error.code === 'LIMIT_FILE_SIZE') {
            return this.createError(
                this.errorTypes.FILE_ERROR,
                'Ukuran file terlalu besar'
            );
        }

        // Default to system error
        return this.createError(
            this.errorTypes.SYSTEM_ERROR,
            error.message
        );
    }

    // Express error handling middleware
    middleware() {
        return async (error, req, res, next) => {
            // Normalize error
            const normalizedError = this.normalizeError(error);

            // Log error
            logger.error(normalizedError, {
                path: req.path,
                method: req.method,
                user: req.user ? req.user._id : null
            });

            // Notify admin for critical errors
            if (this.isCriticalError(normalizedError)) {
                await this.notifyAdmin(normalizedError, req);
            }

            // Send response
            res.status(normalizedError.status || 500).json({
                success: false,
                error: {
                    type: normalizedError.type,
                    message: normalizedError.message,
                    details: normalizedError.details
                }
            });
        };
    }

    // Check if error is critical
    isCriticalError(error) {
        return [
            this.errorTypes.DATABASE_ERROR,
            this.errorTypes.SYSTEM_ERROR,
            this.errorTypes.WHATSAPP_ERROR
        ].includes(error.type);
    }

    // Notify admin about critical errors
    async notifyAdmin(error, req) {
        try {
            const errorContext = {
                type: error.type,
                message: error.message,
                path: req.path,
                method: req.method,
                timestamp: new Date().toISOString(),
                user: req.user ? req.user._id : null,
                ip: req.ip
            };

            await notifier.sendSystemAlert('error', errorContext);
        } catch (notifyError) {
            logger.error(notifyError, { type: 'admin_notification_error' });
        }
    }

    // Handle uncaught exceptions
    handleUncaughtException(error) {
        logger.error(error, { type: 'uncaught_exception' });
        
        // Notify admin
        notifier.sendSystemAlert('critical', {
            type: 'UncaughtException',
            message: error.message,
            stack: error.stack
        }).catch(() => {});

        // Exit process after logging
        process.exit(1);
    }

    // Handle unhandled promise rejections
    handleUnhandledRejection(reason, promise) {
        logger.error(reason, { type: 'unhandled_rejection' });
        
        // Notify admin
        notifier.sendSystemAlert('critical', {
            type: 'UnhandledRejection',
            message: reason.message || 'Unknown reason',
            stack: reason.stack
        }).catch(() => {});
    }

    // Register global error handlers
    registerGlobalHandlers() {
        process.on('uncaughtException', this.handleUncaughtException.bind(this));
        process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    }

    // Validation error helper
    validationError(message, details = null) {
        return this.createError(
            this.errorTypes.VALIDATION_ERROR,
            message,
            details
        );
    }

    // Authentication error helper
    authenticationError(message = null) {
        return this.createError(
            this.errorTypes.AUTHENTICATION_ERROR,
            message
        );
    }

    // Authorization error helper
    authorizationError(message = null) {
        return this.createError(
            this.errorTypes.AUTHORIZATION_ERROR,
            message
        );
    }

    // Not found error helper
    notFoundError(message = null) {
        return this.createError(
            this.errorTypes.NOT_FOUND_ERROR,
            message
        );
    }

    // Database error helper
    databaseError(message = null, details = null) {
        return this.createError(
            this.errorTypes.DATABASE_ERROR,
            message,
            details
        );
    }

    // WhatsApp error helper
    whatsappError(message = null, details = null) {
        return this.createError(
            this.errorTypes.WHATSAPP_ERROR,
            message,
            details
        );
    }

    // File error helper
    fileError(message = null, details = null) {
        return this.createError(
            this.errorTypes.FILE_ERROR,
            message,
            details
        );
    }

    // Rate limit error helper
    rateLimitError(message = null) {
        return this.createError(
            this.errorTypes.RATE_LIMIT_ERROR,
            message
        );
    }

    // System error helper
    systemError(message = null, details = null) {
        return this.createError(
            this.errorTypes.SYSTEM_ERROR,
            message,
            details
        );
    }
}

module.exports = new ErrorHandler();

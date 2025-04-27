/**
 * Resource limits configuration for optimized performance on minimal hosting
 */
module.exports = {
    // Database limits
    db: {
        maxConnections: 10,
        minConnections: 2,
        connectionTimeout: 10000,
        queryTimeout: 5000,
        maxPoolSize: 5
    },

    // File upload limits
    upload: {
        maxFileSize: 1024 * 1024, // 1MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFilesPerRequest: 1
    },

    // Rate limiting
    rateLimit: {
        window: 15 * 60 * 1000, // 15 minutes
        max: 100, // requests per window
        whatsappMax: 50, // WhatsApp messages per window
        uploadMax: 10 // file uploads per window
    },

    // Cache settings
    cache: {
        ttl: 60 * 60, // 1 hour
        maxItems: 1000,
        checkPeriod: 600 // 10 minutes
    },

    // OCR processing
    ocr: {
        maxImageSize: 1024 * 1024, // 1MB
        timeout: 30000, // 30 seconds
        maxConcurrent: 2,
        maxRetries: 2
    },

    // User limits
    user: {
        maxTransactionsPerDay: 100,
        maxStoragePerUser: 100 * 1024 * 1024, // 100MB
        maxConcurrentSessions: 3,
        maxCategories: 20,
        maxBudgets: 10
    },

    // API limits
    api: {
        maxPageSize: 50,
        defaultPageSize: 20,
        maxSearchResults: 100,
        timeout: 10000 // 10 seconds
    },

    // Analytics & Reports
    analytics: {
        maxDataPoints: 1000,
        maxChartItems: 50,
        maxExportRows: 1000,
        reportGenerationTimeout: 30000
    },

    // WhatsApp bot
    whatsapp: {
        maxAttachmentSize: 512 * 1024, // 512KB
        messageQueueSize: 100,
        processingTimeout: 5000,
        maxDailyMessages: 1000
    },

    // System monitoring
    monitoring: {
        checkInterval: 5 * 60 * 1000, // 5 minutes
        alertThreshold: 80, // percentage
        maxLogSize: 10 * 1024 * 1024, // 10MB
        cleanupInterval: 24 * 60 * 60 * 1000 // 24 hours
    }
};

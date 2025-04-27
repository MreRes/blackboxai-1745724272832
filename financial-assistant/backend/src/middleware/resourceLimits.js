const limits = require('../config/limits');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('../utils/errorHandler');

// Rate limiting middleware
const createRateLimiter = (max, windowMs, message) => rateLimit({
    windowMs,
    max,
    message: { success: false, error: message }
});

// File size checker middleware
const fileSizeLimit = (req, res, next) => {
    if (req.files) {
        const files = Array.isArray(req.files) ? req.files : [req.files];
        for (const file of files) {
            if (file.size > limits.upload.maxFileSize) {
                return errorHandler(res, 'File size exceeds limit', 413);
            }
        }
    }
    next();
};

// User storage quota middleware
const checkStorageQuota = async (req, res, next) => {
    try {
        const userStorage = await getUserStorageUsage(req.user.id);
        if (userStorage >= limits.user.maxStoragePerUser) {
            return errorHandler(res, 'Storage quota exceeded', 413);
        }
        next();
    } catch (error) {
        next(error);
    }
};

// Transaction daily limit middleware
const checkTransactionLimit = async (req, res, next) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const transactionCount = await req.app.locals.db.collection('transactions')
            .countDocuments({
                user: req.user.id,
                createdAt: { $gte: today }
            });

        if (transactionCount >= limits.user.maxTransactionsPerDay) {
            return errorHandler(res, 'Daily transaction limit reached', 429);
        }
        next();
    } catch (error) {
        next(error);
    }
};

// OCR processing limit middleware
const checkOCRLimit = async (req, res, next) => {
    try {
        const processingCount = await req.app.locals.db.collection('transactions')
            .countDocuments({
                user: req.user.id,
                'metadata.ocrProcessing': true,
                createdAt: { 
                    $gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
                }
            });

        if (processingCount >= limits.ocr.maxConcurrent) {
            return errorHandler(res, 'Too many OCR requests. Please try again later.', 429);
        }
        next();
    } catch (error) {
        next(error);
    }
};

// Budget limit middleware
const checkBudgetLimit = async (req, res, next) => {
    try {
        const budgetCount = await req.app.locals.db.collection('budgets')
            .countDocuments({
                user: req.user.id,
                status: 'active'
            });

        if (budgetCount >= limits.user.maxBudgets) {
            return errorHandler(res, 'Maximum budget limit reached', 429);
        }
        next();
    } catch (error) {
        next(error);
    }
};

// Category limit middleware
const checkCategoryLimit = async (req, res, next) => {
    try {
        const categories = await req.app.locals.db.collection('transactions')
            .distinct('category', { user: req.user.id });

        if (categories.length >= limits.user.maxCategories && 
            !categories.includes(req.body.category)) {
            return errorHandler(res, 'Maximum category limit reached', 429);
        }
        next();
    } catch (error) {
        next(error);
    }
};

// Pagination limit middleware
const paginationLimit = (req, res, next) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || limits.api.defaultPageSize;
    
    req.query.page = page;
    req.query.limit = Math.min(limit, limits.api.maxPageSize);
    
    next();
};

// Helper function to get user storage usage
const getUserStorageUsage = async (userId) => {
    const aggregation = await req.app.locals.db.collection('transactions')
        .aggregate([
            { $match: { user: userId } },
            { $project: { 
                attachmentSize: { 
                    $sum: { 
                        $map: { 
                            input: '$attachments', 
                            as: 'attachment',
                            in: { $strLenBytes: '$$attachment.data' }
                        } 
                    } 
                }
            }},
            { $group: {
                _id: null,
                totalSize: { $sum: '$attachmentSize' }
            }}
        ]).toArray();

    return aggregation[0]?.totalSize || 0;
};

// Export all middlewares
module.exports = {
    // Rate limiters
    apiLimiter: createRateLimiter(
        limits.rateLimit.max,
        limits.rateLimit.window,
        'Too many requests'
    ),
    whatsappLimiter: createRateLimiter(
        limits.rateLimit.whatsappMax,
        limits.rateLimit.window,
        'Too many WhatsApp messages'
    ),
    uploadLimiter: createRateLimiter(
        limits.rateLimit.uploadMax,
        limits.rateLimit.window,
        'Too many file uploads'
    ),

    // Resource limits
    fileSizeLimit,
    checkStorageQuota,
    checkTransactionLimit,
    checkOCRLimit,
    checkBudgetLimit,
    checkCategoryLimit,
    paginationLimit
};

const express = require('express');
const router = express.Router();
const transactionHandler = require('../handlers/transaction.js');
const authHandler = require('../handlers/auth.js');
const { body, query, validationResult } = require('express-validator');

// Validation middleware
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

// Create transaction
router.post('/',
    authHandler.authMiddleware(),
    [
        body('type').isIn(['income', 'expense']),
        body('amount').isFloat({ min: 0 }),
        body('category').trim().notEmpty(),
        body('description').optional().trim(),
        body('date').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.createTransaction(
                req.user._id,
                req.body,
                'web'
            );
            res.json(result);
        } catch (error) {
            console.error('Create transaction error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get transactions with filters
router.get('/',
    authHandler.authMiddleware(),
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('type').optional().isIn(['income', 'expense']),
        query('category').optional().trim(),
        query('source').optional().isIn(['web', 'whatsapp', 'system']),
        query('limit').optional().isInt({ min: 1, max: 1000 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.getTransactions(
                req.user._id,
                req.query
            );
            res.json(result);
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get transaction statistics
router.get('/statistics',
    authHandler.authMiddleware(),
    [
        query('period').optional().isIn(['daily', 'monthly', 'yearly'])
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.getStatistics(
                req.user._id,
                req.query.period
            );
            res.json(result);
        } catch (error) {
            console.error('Get statistics error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Update transaction
router.put('/:id',
    authHandler.authMiddleware(),
    [
        body('amount').optional().isFloat({ min: 0 }),
        body('category').optional().trim(),
        body('description').optional().trim(),
        body('date').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.updateTransaction(
                req.user._id,
                req.params.id,
                req.body
            );
            res.json(result);
        } catch (error) {
            console.error('Update transaction error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Delete transaction
router.delete('/:id',
    authHandler.authMiddleware(),
    async (req, res) => {
        try {
            const result = await transactionHandler.deleteTransaction(
                req.user._id,
                req.params.id
            );
            res.json(result);
        } catch (error) {
            console.error('Delete transaction error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Admin routes

// Get all user transactions (Admin only)
router.get('/admin/all',
    authHandler.authMiddleware(true),
    [
        query('userId').optional().isMongoId(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('type').optional().isIn(['income', 'expense']),
        query('category').optional().trim(),
        query('source').optional().isIn(['web', 'whatsapp', 'system']),
        query('limit').optional().isInt({ min: 1, max: 1000 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.getTransactions(
                req.query.userId || null,
                req.query
            );
            res.json(result);
        } catch (error) {
            console.error('Admin get transactions error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get all user statistics (Admin only)
router.get('/admin/statistics',
    authHandler.authMiddleware(true),
    [
        query('userId').optional().isMongoId(),
        query('period').optional().isIn(['daily', 'monthly', 'yearly'])
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await transactionHandler.getStatistics(
                req.query.userId || null,
                req.query.period
            );
            res.json(result);
        } catch (error) {
            console.error('Admin get statistics error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Export transactions (Admin only)
router.get('/admin/export',
    authHandler.authMiddleware(true),
    [
        query('userId').optional().isMongoId(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('format').optional().isIn(['csv', 'excel'])
    ],
    validateRequest,
    async (req, res) => {
        try {
            // TODO: Implement export functionality
            res.status(501).json({
                success: false,
                message: 'Export functionality not implemented yet'
            });
        } catch (error) {
            console.error('Export transactions error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

module.exports = router;

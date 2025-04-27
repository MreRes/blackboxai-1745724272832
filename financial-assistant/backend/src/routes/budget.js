const express = require('express');
const router = express.Router();
const budgetHandler = require('../handlers/budget.js');
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

// Create budget
router.post('/',
    authHandler.authMiddleware(),
    [
        body('name').trim().notEmpty(),
        body('type').isIn(['expense', 'income', 'savings']),
        body('amount').isFloat({ min: 0 }),
        body('period').isIn(['daily', 'weekly', 'monthly', 'yearly', 'custom']),
        body('startDate').isISO8601(),
        body('endDate').isISO8601(),
        body('categories').isArray(),
        body('categories.*.name').trim().notEmpty(),
        body('categories.*.amount').isFloat({ min: 0 }),
        body('notifications').optional().isObject(),
        body('recurring').optional().isObject()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await budgetHandler.createBudget(
                req.user._id,
                {
                    ...req.body,
                    source: 'web'
                }
            );
            res.json(result);
        } catch (error) {
            console.error('Create budget error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get budgets
router.get('/',
    authHandler.authMiddleware(),
    [
        query('status').optional().isIn(['active', 'completed', 'cancelled']),
        query('date').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await budgetHandler.getBudgets(
                req.user._id,
                req.query
            );
            res.json(result);
        } catch (error) {
            console.error('Get budgets error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Update budget
router.put('/:id',
    authHandler.authMiddleware(),
    [
        body('name').optional().trim(),
        body('amount').optional().isFloat({ min: 0 }),
        body('categories').optional().isArray(),
        body('categories.*.name').optional().trim(),
        body('categories.*.amount').optional().isFloat({ min: 0 }),
        body('notifications').optional().isObject(),
        body('endDate').optional().isISO8601(),
        body('status').optional().isIn(['active', 'completed', 'cancelled'])
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await budgetHandler.updateBudget(
                req.user._id,
                req.params.id,
                req.body
            );
            res.json(result);
        } catch (error) {
            console.error('Update budget error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get budget recommendations
router.get('/recommendations',
    authHandler.authMiddleware(),
    async (req, res) => {
        try {
            const result = await budgetHandler.getBudgetRecommendations(
                req.user._id
            );
            res.json(result);
        } catch (error) {
            console.error('Get recommendations error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Admin routes

// Get all user budgets (Admin only)
router.get('/admin/all',
    authHandler.authMiddleware(true),
    [
        query('userId').optional().isMongoId(),
        query('status').optional().isIn(['active', 'completed', 'cancelled']),
        query('date').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const result = await budgetHandler.getBudgets(
                req.query.userId || null,
                req.query
            );
            res.json(result);
        } catch (error) {
            console.error('Admin get budgets error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get budget statistics for all users (Admin only)
router.get('/admin/statistics',
    authHandler.authMiddleware(true),
    [
        query('userId').optional().isMongoId(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            // TODO: Implement admin statistics
            const statistics = {
                totalBudgets: 0,
                activeBudgets: 0,
                completedBudgets: 0,
                cancelledBudgets: 0,
                totalAllocated: 0,
                totalSpent: 0,
                overBudgetCount: 0,
                userStatistics: []
            };

            res.json({
                success: true,
                statistics
            });
        } catch (error) {
            console.error('Admin statistics error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Create budget template (Admin only)
router.post('/admin/templates',
    authHandler.authMiddleware(true),
    [
        body('name').trim().notEmpty(),
        body('type').isIn(['expense', 'income', 'savings']),
        body('period').isIn(['daily', 'weekly', 'monthly', 'yearly']),
        body('categories').isArray(),
        body('categories.*.name').trim().notEmpty(),
        body('categories.*.defaultAmount').isFloat({ min: 0 }),
        body('description').optional().trim()
    ],
    validateRequest,
    async (req, res) => {
        try {
            // TODO: Implement budget templates
            res.status(501).json({
                success: false,
                message: 'Budget templates not implemented yet'
            });
        } catch (error) {
            console.error('Create template error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get budget insights (Admin only)
router.get('/admin/insights',
    authHandler.authMiddleware(true),
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601()
    ],
    validateRequest,
    async (req, res) => {
        try {
            // TODO: Implement budget insights
            const insights = {
                topPerformingCategories: [],
                problemAreas: [],
                trendAnalysis: [],
                recommendations: []
            };

            res.json({
                success: true,
                insights
            });
        } catch (error) {
            console.error('Get insights error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

module.exports = router;

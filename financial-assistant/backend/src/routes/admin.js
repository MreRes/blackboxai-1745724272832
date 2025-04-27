const express = require('express');
const router = express.Router();
const authHandler = require('../handlers/auth.js');
const User = require('../models/user.js');
const { body, query, validationResult } = require('express-validator');
const fs = require('fs').promises;
const path = require('path');

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

// Get all users
router.get('/users',
    authHandler.authMiddleware(true),
    [
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('status').optional().isIn(['active', 'expired']),
        query('search').optional().trim()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            let query = { isAdmin: false };

            // Apply status filter
            if (req.query.status) {
                const now = new Date();
                if (req.query.status === 'active') {
                    query.expiryDate = { $gt: now };
                } else {
                    query.expiryDate = { $lte: now };
                }
            }

            // Apply search filter
            if (req.query.search) {
                query.$or = [
                    { username: new RegExp(req.query.search, 'i') },
                    { 'phoneNumbers.number': new RegExp(req.query.search, 'i') }
                ];
            }

            const users = await User.find(query)
                .select('-password -activationCode')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 });

            const total = await User.countDocuments(query);

            res.json({
                success: true,
                data: {
                    users,
                    pagination: {
                        page,
                        limit,
                        total,
                        pages: Math.ceil(total / limit)
                    }
                }
            });
        } catch (error) {
            console.error('Get users error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Update user settings
router.put('/users/:userId',
    authHandler.authMiddleware(true),
    [
        body('maxPhoneNumbers').optional().isInt({ min: 1 }),
        body('expiryDate').optional().isISO8601(),
        body('status').optional().isIn(['active', 'suspended'])
    ],
    validateRequest,
    async (req, res) => {
        try {
            const user = await User.findOne({
                _id: req.params.userId,
                isAdmin: false
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User tidak ditemukan'
                });
            }

            // Update allowed fields
            if (req.body.maxPhoneNumbers) {
                user.maxPhoneNumbers = req.body.maxPhoneNumbers;
            }
            if (req.body.expiryDate) {
                user.expiryDate = new Date(req.body.expiryDate);
            }
            if (req.body.status === 'suspended') {
                user.expiryDate = new Date(); // Set to current date to expire immediately
            }

            await user.save();

            res.json({
                success: true,
                user: {
                    ...user.toObject(),
                    password: undefined,
                    activationCode: undefined
                }
            });
        } catch (error) {
            console.error('Update user error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// System backup
router.post('/backup',
    authHandler.authMiddleware(true),
    async (req, res) => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(__dirname, '../../../backups');
            
            // Create backup directory if it doesn't exist
            await fs.mkdir(backupDir, { recursive: true });

            // Backup users
            const users = await User.find({}).select('-password -activationCode');
            await fs.writeFile(
                path.join(backupDir, `users-${timestamp}.json`),
                JSON.stringify(users, null, 2)
            );

            // Backup transactions
            const Transaction = require('../models/transaction');
            const transactions = await Transaction.find({});
            await fs.writeFile(
                path.join(backupDir, `transactions-${timestamp}.json`),
                JSON.stringify(transactions, null, 2)
            );

            // Backup budgets
            const Budget = require('../models/budget');
            const budgets = await Budget.find({});
            await fs.writeFile(
                path.join(backupDir, `budgets-${timestamp}.json`),
                JSON.stringify(budgets, null, 2)
            );

            res.json({
                success: true,
                message: 'Backup berhasil dibuat',
                timestamp
            });
        } catch (error) {
            console.error('Backup error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// System restore
router.post('/restore',
    authHandler.authMiddleware(true),
    [
        body('timestamp').trim().notEmpty()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { timestamp } = req.body;
            const backupDir = path.join(__dirname, '../../../backups');

            // Verify backup files exist
            const files = ['users', 'transactions', 'budgets'].map(
                type => path.join(backupDir, `${type}-${timestamp}.json`)
            );

            for (const file of files) {
                if (!await fs.access(file).then(() => true).catch(() => false)) {
                    return res.status(404).json({
                        success: false,
                        message: `Backup file tidak ditemukan: ${path.basename(file)}`
                    });
                }
            }

            // Clear existing data
            await Promise.all([
                User.deleteMany({ isAdmin: false }), // Preserve admin accounts
                Transaction.deleteMany({}),
                Budget.deleteMany({})
            ]);

            // Restore data
            const [users, transactions, budgets] = await Promise.all(
                files.map(file => fs.readFile(file, 'utf8').then(JSON.parse))
            );

            await Promise.all([
                User.insertMany(users),
                Transaction.insertMany(transactions),
                Budget.insertMany(budgets)
            ]);

            res.json({
                success: true,
                message: 'Restore berhasil dilakukan',
                stats: {
                    users: users.length,
                    transactions: transactions.length,
                    budgets: budgets.length
                }
            });
        } catch (error) {
            console.error('Restore error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get system statistics
router.get('/statistics',
    authHandler.authMiddleware(true),
    async (req, res) => {
        try {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            const stats = {
                users: {
                    total: await User.countDocuments({ isAdmin: false }),
                    active: await User.countDocuments({
                        isAdmin: false,
                        expiryDate: { $gt: now }
                    })
                },
                transactions: {
                    total: await Transaction.countDocuments({}),
                    today: await Transaction.countDocuments({
                        date: { $gte: today }
                    }),
                    thisMonth: await Transaction.countDocuments({
                        date: { $gte: thisMonth }
                    })
                },
                budgets: {
                    total: await Budget.countDocuments({}),
                    active: await Budget.countDocuments({
                        status: 'active',
                        startDate: { $lte: now },
                        endDate: { $gt: now }
                    })
                }
            };

            res.json({
                success: true,
                statistics: stats
            });
        } catch (error) {
            console.error('Get statistics error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Update WhatsApp settings
router.post('/whatsapp/settings',
    authHandler.authMiddleware(true),
    [
        body('autoReconnect').optional().isBoolean(),
        body('sessionTimeout').optional().isInt({ min: 0 }),
        body('maxReconnectAttempts').optional().isInt({ min: 0 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            // TODO: Implement WhatsApp settings update
            res.status(501).json({
                success: false,
                message: 'WhatsApp settings update not implemented yet'
            });
        } catch (error) {
            console.error('Update WhatsApp settings error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

module.exports = router;

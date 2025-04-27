const express = require('express');
const router = express.Router();
const authHandler = require('../handlers/auth.js');
const { body, validationResult } = require('express-validator');

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

// User registration (Admin only)
router.post('/register', 
    authHandler.authMiddleware(true), // Require admin
    [
        body('username').isLength({ min: 3 }).trim().escape(),
        body('maxPhoneNumbers').optional().isInt({ min: 1 }),
        body('expiryDays').optional().isInt({ min: 1 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { username, maxPhoneNumbers, expiryDays } = req.body;
            const result = await authHandler.createUser(
                username,
                false, // isAdmin
                maxPhoneNumbers,
                expiryDays
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Admin registration (Super admin only)
router.post('/register-admin',
    authHandler.authMiddleware(true),
    [
        body('username').isLength({ min: 3 }).trim().escape()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { username } = req.body;
            const result = await authHandler.createUser(
                username,
                true // isAdmin
            );

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Admin registration error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// User login
router.post('/login',
    [
        body('username').trim().escape(),
        body('activationCode').trim().escape()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { username, activationCode } = req.body;
            const result = await authHandler.handleWebLogin(
                username,
                activationCode,
                false // isAdmin
            );

            if (!result.success) {
                return res.status(401).json(result);
            }

            res.json(result);
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Admin login
router.post('/admin/login',
    [
        body('username').trim().escape(),
        body('password').trim()
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { username, password } = req.body;
            const result = await authHandler.handleWebLogin(
                username,
                password,
                true // isAdmin
            );

            if (!result.success) {
                return res.status(401).json(result);
            }

            res.json(result);
        } catch (error) {
            console.error('Admin login error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Verify token
router.get('/verify',
    authHandler.authMiddleware(),
    async (req, res) => {
        try {
            res.json({
                success: true,
                user: {
                    id: req.user._id,
                    username: req.user.username,
                    isAdmin: req.user.isAdmin,
                    expiryDate: req.user.expiryDate
                }
            });
        } catch (error) {
            console.error('Token verification error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Update activation code (Admin only)
router.post('/update-activation',
    authHandler.authMiddleware(true),
    [
        body('username').trim().escape(),
        body('expiryDays').isInt({ min: 1 })
    ],
    validateRequest,
    async (req, res) => {
        try {
            const { username, expiryDays } = req.body;
            const user = await User.findOne({ username, isAdmin: false });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User tidak ditemukan'
                });
            }

            const newActivationCode = authHandler.generateActivationCode();
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + expiryDays);

            user.activationCode = newActivationCode;
            user.expiryDate = expiryDate;
            await user.save();

            res.json({
                success: true,
                data: {
                    username: user.username,
                    activationCode: newActivationCode, // Plain code before hashing
                    expiryDate: user.expiryDate
                }
            });
        } catch (error) {
            console.error('Update activation error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// Get user status
router.get('/status/:username',
    authHandler.authMiddleware(true),
    async (req, res) => {
        try {
            const user = await User.findOne({ 
                username: req.params.username,
                isAdmin: false
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User tidak ditemukan'
                });
            }

            res.json({
                success: true,
                data: {
                    username: user.username,
                    phoneNumbers: user.phoneNumbers,
                    maxPhoneNumbers: user.maxPhoneNumbers,
                    expiryDate: user.expiryDate,
                    isActive: user.isSubscriptionActive()
                }
            });
        } catch (error) {
            console.error('Get user status error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

module.exports = router;

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');

class Security {
    constructor() {
        this.SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
        this.JWT_SECRET = process.env.JWT_SECRET;
        this.JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
        this.RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 900000; // 15 minutes
        this.RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100;
    }

    // Password hashing
    async hashPassword(password) {
        return await bcrypt.hash(password, this.SALT_ROUNDS);
    }

    async comparePassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // JWT token management
    generateToken(payload, expiresIn = this.JWT_EXPIRY) {
        return jwt.sign(payload, this.JWT_SECRET, { expiresIn });
    }

    verifyToken(token) {
        try {
            return jwt.verify(token, this.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    // Generate secure random strings
    generateSecureString(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    // Generate activation code
    generateActivationCode(length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        const randomBytes = crypto.randomBytes(length);
        
        for (let i = 0; i < length; i++) {
            code += chars[randomBytes[i] % chars.length];
        }
        
        return code;
    }

    // Express security middleware
    getSecurityMiddleware() {
        return [
            // Helmet for security headers
            helmet({
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
                        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
                        fontSrc: ["'self'", 'fonts.gstatic.com'],
                        imgSrc: ["'self'", 'data:', 'https:'],
                        connectSrc: ["'self'"],
                    },
                },
                crossOriginEmbedderPolicy: false,
                crossOriginResourcePolicy: { policy: "cross-origin" }
            }),

            // CORS configuration
            cors({
                origin: process.env.CORS_ORIGIN || '*',
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization'],
                credentials: true
            }),

            // Rate limiting
            this.getRateLimiter()
        ];
    }

    // Rate limiter
    getRateLimiter() {
        return rateLimit({
            windowMs: this.RATE_LIMIT_WINDOW,
            max: this.RATE_LIMIT_MAX,
            message: {
                success: false,
                message: 'Too many requests, please try again later.'
            },
            handler: (req, res, next, options) => {
                logger.error(new Error('Rate limit exceeded'), {
                    ip: req.ip,
                    path: req.path
                });
                res.status(429).json(options.message);
            }
        });
    }

    // Authentication middleware
    authenticate(requireAdmin = false) {
        return async (req, res, next) => {
            try {
                const token = req.headers.authorization?.split(' ')[1];
                
                if (!token) {
                    return res.status(401).json({
                        success: false,
                        message: 'Authentication token is required'
                    });
                }

                const decoded = this.verifyToken(token);
                if (!decoded) {
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid or expired token'
                    });
                }

                // Get user from database
                const User = require('../models/user');
                const user = await User.findById(decoded.userId);
                
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: 'User not found'
                    });
                }

                // Check if admin is required
                if (requireAdmin && !user.isAdmin) {
                    return res.status(403).json({
                        success: false,
                        message: 'Admin access required'
                    });
                }

                // Check if user's subscription is active
                if (!user.isAdmin && !user.isSubscriptionActive()) {
                    return res.status(403).json({
                        success: false,
                        message: 'Your subscription has expired'
                    });
                }

                req.user = user;
                next();

            } catch (error) {
                logger.error(error, {
                    type: 'authentication_error',
                    path: req.path
                });
                
                res.status(500).json({
                    success: false,
                    message: 'Authentication error'
                });
            }
        };
    }

    // Input validation middleware
    validateInput(schema) {
        return (req, res, next) => {
            try {
                const { error } = schema.validate(req.body);
                if (error) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid input',
                        errors: error.details.map(detail => detail.message)
                    });
                }
                next();
            } catch (error) {
                logger.error(error, {
                    type: 'validation_error',
                    path: req.path
                });
                
                res.status(500).json({
                    success: false,
                    message: 'Validation error'
                });
            }
        };
    }

    // Sanitize input
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        return input
            .replace(/[<>]/g, '') // Remove < and >
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+=/gi, '') // Remove event handlers
            .trim();
    }

    // Encrypt sensitive data
    encryptData(data) {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(this.JWT_SECRET, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }

    // Decrypt sensitive data
    decryptData(encryptedData) {
        try {
            const algorithm = 'aes-256-gcm';
            const key = crypto.scryptSync(this.JWT_SECRET, 'salt', 32);
            const decipher = crypto.createDecipheriv(
                algorithm,
                key,
                Buffer.from(encryptedData.iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
            
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return JSON.parse(decrypted);
        } catch (error) {
            logger.error(error, { type: 'decryption_error' });
            return null;
        }
    }

    // Check file security
    isSecureFile(file) {
        // List of allowed file types
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || '')
            .split(',')
            .map(type => type.trim());

        // Maximum file size (default: 5MB)
        const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

        return (
            allowedTypes.includes(file.mimetype) &&
            file.size <= maxSize
        );
    }

    // Generate secure filename
    generateSecureFilename(originalname) {
        const ext = originalname.split('.').pop();
        return `${this.generateSecureString(16)}.${ext}`;
    }

    // Audit logging middleware
    auditLog(action) {
        return async (req, res, next) => {
            try {
                const audit = {
                    action,
                    user: req.user?._id,
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    method: req.method,
                    path: req.path,
                    params: req.params,
                    query: req.query,
                    body: this.sanitizeAuditData(req.body),
                    timestamp: new Date()
                };

                // Log to database
                const mongoose = require('mongoose');
                await mongoose.connection.collection('audit_logs').insertOne(audit);

                next();
            } catch (error) {
                logger.error(error, { type: 'audit_log_error' });
                next();
            }
        };
    }

    // Sanitize sensitive data for audit logs
    sanitizeAuditData(data) {
        if (!data) return data;

        const sensitiveFields = ['password', 'token', 'activationCode', 'secret'];
        const sanitized = { ...data };

        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }
}

module.exports = new Security();

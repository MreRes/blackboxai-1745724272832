const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.js');
const crypto = require('crypto');

class AuthHandler {
    constructor() {
        this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
        this.ACTIVATION_CODE_LENGTH = 8;
        this.DEFAULT_EXPIRY_DAYS = 30;
    }

    // Generate random activation code
    generateActivationCode() {
        return crypto.randomBytes(4).toString('hex').toUpperCase();
    }

    // Generate JWT token
    generateToken(userId, isAdmin = false) {
        return jwt.sign(
            { userId, isAdmin },
            this.JWT_SECRET,
            { expiresIn: '24h' }
        );
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            return jwt.verify(token, this.JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    // Create new user
    async createUser(username, isAdmin = false, maxPhoneNumbers = 1, expiryDays = null) {
        try {
            const activationCode = this.generateActivationCode();
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + (expiryDays || this.DEFAULT_EXPIRY_DAYS));

            const user = new User({
                username,
                activationCode,
                maxPhoneNumbers,
                expiryDate,
                isAdmin
            });

            if (isAdmin) {
                const defaultPassword = crypto.randomBytes(8).toString('hex');
                user.password = defaultPassword;
            }

            await user.save();

            return {
                user: {
                    username: user.username,
                    activationCode: activationCode, // Plain activation code before hashing
                    expiryDate: user.expiryDate,
                    maxPhoneNumbers: user.maxPhoneNumbers
                },
                password: isAdmin ? defaultPassword : null
            };
        } catch (error) {
            console.error('Error creating user:', error);
            throw new Error('Failed to create user');
        }
    }

    // Handle WhatsApp registration
    async handleWhatsAppRegistration(phoneNumber) {
        try {
            // Check if phone number is already registered
            const existingUser = await User.findOne({
                'phoneNumbers.number': phoneNumber
            });

            if (existingUser) {
                return {
                    success: false,
                    message: 'Nomor telepon sudah terdaftar'
                };
            }

            return {
                success: true,
                message: 'Silakan hubungi admin untuk mendapatkan kode aktivasi'
            };
        } catch (error) {
            console.error('Error handling registration:', error);
            throw new Error('Gagal memproses pendaftaran');
        }
    }

    // Handle WhatsApp activation
    async handleWhatsAppActivation(phoneNumber, username, activationCode) {
        try {
            const user = await User.findOne({ username });

            if (!user) {
                return {
                    success: false,
                    message: 'Username tidak ditemukan'
                };
            }

            // Verify activation code
            const isValidCode = await user.compareActivationCode(activationCode);
            if (!isValidCode) {
                return {
                    success: false,
                    message: 'Kode aktivasi tidak valid'
                };
            }

            // Check if user can add more phone numbers
            if (!user.canAddPhoneNumber()) {
                return {
                    success: false,
                    message: 'Batas maksimum nomor telepon tercapai'
                };
            }

            // Check if subscription is active
            if (!user.isSubscriptionActive()) {
                return {
                    success: false,
                    message: 'Masa aktif telah berakhir'
                };
            }

            // Add phone number to user
            user.addPhoneNumber(phoneNumber);
            await user.save();

            return {
                success: true,
                message: 'Aktivasi berhasil! Selamat menggunakan layanan kami'
            };
        } catch (error) {
            console.error('Error handling activation:', error);
            throw new Error('Gagal memproses aktivasi');
        }
    }

    // Handle web dashboard login
    async handleWebLogin(username, password, isAdmin = false) {
        try {
            const user = await User.findOne({ username, isAdmin });

            if (!user) {
                return {
                    success: false,
                    message: 'Username atau password salah'
                };
            }

            if (isAdmin) {
                const isValidPassword = await user.comparePassword(password);
                if (!isValidPassword) {
                    return {
                        success: false,
                        message: 'Username atau password salah'
                    };
                }
            } else {
                const isValidCode = await user.compareActivationCode(password);
                if (!isValidCode) {
                    return {
                        success: false,
                        message: 'Username atau kode aktivasi salah'
                    };
                }
            }

            // Check subscription for non-admin users
            if (!isAdmin && !user.isSubscriptionActive()) {
                return {
                    success: false,
                    message: 'Masa aktif telah berakhir'
                };
            }

            const token = this.generateToken(user._id, isAdmin);

            return {
                success: true,
                token,
                user: {
                    id: user._id,
                    username: user.username,
                    isAdmin: user.isAdmin,
                    expiryDate: user.expiryDate
                }
            };
        } catch (error) {
            console.error('Error handling login:', error);
            throw new Error('Gagal memproses login');
        }
    }

    // Middleware to verify authentication
    authMiddleware(requireAdmin = false) {
        return async (req, res, next) => {
            try {
                const token = req.headers.authorization?.split(' ')[1];
                
                if (!token) {
                    return res.status(401).json({
                        success: false,
                        message: 'Token tidak ditemukan'
                    });
                }

                const decoded = this.verifyToken(token);
                if (!decoded) {
                    return res.status(401).json({
                        success: false,
                        message: 'Token tidak valid'
                    });
                }

                const user = await User.findById(decoded.userId);
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: 'User tidak ditemukan'
                    });
                }

                if (requireAdmin && !user.isAdmin) {
                    return res.status(403).json({
                        success: false,
                        message: 'Akses ditolak'
                    });
                }

                req.user = user;
                next();
            } catch (error) {
                console.error('Auth middleware error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error'
                });
            }
        };
    }
}

module.exports = new AuthHandler();

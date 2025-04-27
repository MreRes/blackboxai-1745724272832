const Joi = require('joi');
const moment = require('moment');

class Validator {
    constructor() {
        // Common validation patterns
        this.patterns = {
            phone: /^(?:\+62|62|0)(?:\d{8,15})$/,
            password: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
            username: /^[a-zA-Z0-9_]{3,20}$/
        };

        // Initialize validation schemas
        this.initializeSchemas();
    }

    initializeSchemas() {
        // User Schemas
        this.userSchemas = {
            registration: Joi.object({
                username: Joi.string()
                    .pattern(this.patterns.username)
                    .required()
                    .messages({
                        'string.pattern.base': 'Username hanya boleh mengandung huruf, angka, dan underscore (3-20 karakter)'
                    }),
                maxPhoneNumbers: Joi.number()
                    .integer()
                    .min(1)
                    .max(5)
                    .default(1),
                expiryDays: Joi.number()
                    .integer()
                    .min(1)
                    .default(30)
            }),

            activation: Joi.object({
                username: Joi.string()
                    .pattern(this.patterns.username)
                    .required(),
                activationCode: Joi.string()
                    .length(8)
                    .required(),
                phoneNumber: Joi.string()
                    .pattern(this.patterns.phone)
                    .required()
                    .messages({
                        'string.pattern.base': 'Format nomor telepon tidak valid'
                    })
            }),

            adminRegistration: Joi.object({
                username: Joi.string()
                    .pattern(this.patterns.username)
                    .required(),
                password: Joi.string()
                    .pattern(this.patterns.password)
                    .required()
                    .messages({
                        'string.pattern.base': 'Password harus minimal 8 karakter dan mengandung huruf dan angka'
                    })
            })
        };

        // Transaction Schemas
        this.transactionSchemas = {
            create: Joi.object({
                type: Joi.string()
                    .valid('income', 'expense')
                    .required(),
                amount: Joi.number()
                    .positive()
                    .required(),
                category: Joi.string()
                    .required(),
                description: Joi.string()
                    .max(500)
                    .allow('', null),
                date: Joi.date()
                    .max('now')
                    .default(Date.now),
                attachments: Joi.array().items(
                    Joi.object({
                        type: Joi.string()
                            .valid('image', 'voice', 'document'),
                        url: Joi.string()
                            .uri(),
                        processedText: Joi.string()
                            .allow('', null)
                    })
                )
            }),

            update: Joi.object({
                amount: Joi.number()
                    .positive(),
                category: Joi.string(),
                description: Joi.string()
                    .max(500)
                    .allow('', null),
                date: Joi.date()
                    .max('now')
            })
        };

        // Budget Schemas
        this.budgetSchemas = {
            create: Joi.object({
                name: Joi.string()
                    .required(),
                type: Joi.string()
                    .valid('expense', 'income', 'savings')
                    .required(),
                amount: Joi.number()
                    .positive()
                    .required(),
                period: Joi.string()
                    .valid('daily', 'weekly', 'monthly', 'yearly', 'custom')
                    .required(),
                startDate: Joi.date()
                    .required(),
                endDate: Joi.date()
                    .min(Joi.ref('startDate'))
                    .required(),
                categories: Joi.array().items(
                    Joi.object({
                        name: Joi.string()
                            .required(),
                        amount: Joi.number()
                            .positive()
                            .required()
                    })
                ).required(),
                notifications: Joi.object({
                    enabled: Joi.boolean()
                        .default(true),
                    threshold: Joi.number()
                        .min(1)
                        .max(100)
                        .default(80),
                    frequency: Joi.string()
                        .valid('daily', 'weekly', 'monthly', 'on_threshold')
                        .default('on_threshold')
                })
            })
        };

        // WhatsApp Message Schemas
        this.whatsappSchemas = {
            transaction: Joi.object({
                type: Joi.string()
                    .valid('income', 'expense')
                    .required(),
                amount: Joi.number()
                    .positive()
                    .required(),
                category: Joi.string()
                    .required(),
                description: Joi.string()
                    .max(500)
                    .allow('', null)
            })
        };
    }

    // Format currency
    formatCurrency(amount, currency = 'IDR') {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    // Format date
    formatDate(date, format = 'DD/MM/YYYY') {
        return moment(date).format(format);
    }

    // Format phone number
    formatPhoneNumber(phone) {
        // Remove any non-digit characters
        phone = phone.replace(/\D/g, '');

        // Ensure number starts with proper country code
        if (phone.startsWith('0')) {
            phone = '62' + phone.substring(1);
        } else if (!phone.startsWith('62')) {
            phone = '62' + phone;
        }

        return phone;
    }

    // Validate and format transaction from WhatsApp message
    parseTransactionMessage(message) {
        // Common patterns for Indonesian currency format
        const patterns = {
            amount: /(?:rp\.?\s?|\d+)\s*(?:\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})?|\d+(?:[,.]\d{2})?)/i,
            category: /(?:untuk|buat|dari)\s+([^0-9,.]+?)(?=\s+(?:rp|[0-9]|$)|$)/i
        };

        let type = 'expense';
        if (message.toLowerCase().includes('masuk') || 
            message.toLowerCase().includes('terima') || 
            message.toLowerCase().includes('dapat')) {
            type = 'income';
        }

        // Extract amount
        const amountMatch = message.match(patterns.amount);
        let amount = null;
        if (amountMatch) {
            amount = amountMatch[0]
                .toLowerCase()
                .replace(/rp\.?\s?/i, '')
                .replace(/[,.]/g, '')
                .trim();
            amount = parseInt(amount);
        }

        // Extract category
        const categoryMatch = message.match(patterns.category);
        const category = categoryMatch ? categoryMatch[1].trim() : null;

        // Validate extracted data
        const { error } = this.whatsappSchemas.transaction.validate({
            type,
            amount,
            category,
            description: message
        });

        if (error) {
            return {
                success: false,
                error: 'Format pesan tidak valid'
            };
        }

        return {
            success: true,
            data: {
                type,
                amount,
                category,
                description: message
            }
        };
    }

    // Generate error message
    formatError(error) {
        if (error.isJoi) {
            return error.details.map(detail => detail.message).join(', ');
        }
        return error.message;
    }

    // Validate object against schema
    validate(data, schema) {
        const { error, value } = schema.validate(data, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            return {
                success: false,
                error: this.formatError(error)
            };
        }

        return {
            success: true,
            data: value
        };
    }

    // Get schema by name
    getSchema(type, name) {
        const schemas = {
            user: this.userSchemas,
            transaction: this.transactionSchemas,
            budget: this.budgetSchemas,
            whatsapp: this.whatsappSchemas
        };

        return schemas[type]?.[name];
    }
}

module.exports = new Validator();

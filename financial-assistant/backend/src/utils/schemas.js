const Joi = require('joi');
const i18n = require('./i18n');

// Custom Joi messages in Indonesian
const messages = {
    'string.base': '{#label} harus berupa teks',
    'string.empty': '{#label} tidak boleh kosong',
    'string.min': '{#label} minimal {#limit} karakter',
    'string.max': '{#label} maksimal {#limit} karakter',
    'string.email': '{#label} harus berupa email yang valid',
    'string.pattern.base': '{#label} tidak valid',
    'number.base': '{#label} harus berupa angka',
    'number.min': '{#label} minimal {#limit}',
    'number.max': '{#label} maksimal {#limit}',
    'number.positive': '{#label} harus bernilai positif',
    'date.base': '{#label} harus berupa tanggal yang valid',
    'date.min': '{#label} tidak boleh sebelum {#limit}',
    'date.max': '{#label} tidak boleh setelah {#limit}',
    'array.base': '{#label} harus berupa array',
    'array.min': '{#label} minimal {#limit} item',
    'array.max': '{#label} maksimal {#limit} item',
    'object.base': '{#label} harus berupa objek',
    'any.required': '{#label} wajib diisi',
    'any.only': '{#label} tidak valid'
};

// Common patterns
const patterns = {
    phone: /^(?:\+62|62|0)(?:\d{8,15})$/,
    username: /^[a-zA-Z0-9_]{3,20}$/,
    password: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/
};

// User Schemas
const userSchemas = {
    registration: Joi.object({
        username: Joi.string()
            .pattern(patterns.username)
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
            .pattern(patterns.username)
            .required(),
        activationCode: Joi.string()
            .length(8)
            .required(),
        phoneNumber: Joi.string()
            .pattern(patterns.phone)
            .required()
            .messages({
                'string.pattern.base': 'Format nomor telepon tidak valid'
            })
    }),

    adminRegistration: Joi.object({
        username: Joi.string()
            .pattern(patterns.username)
            .required(),
        password: Joi.string()
            .pattern(patterns.password)
            .required()
            .messages({
                'string.pattern.base': 'Password minimal 8 karakter dan harus mengandung huruf dan angka'
            })
    })
};

// Transaction Schemas
const transactionSchemas = {
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
    }),

    filter: Joi.object({
        startDate: Joi.date(),
        endDate: Joi.date()
            .min(Joi.ref('startDate')),
        type: Joi.string()
            .valid('income', 'expense'),
        category: Joi.string(),
        minAmount: Joi.number()
            .positive(),
        maxAmount: Joi.number()
            .positive()
            .min(Joi.ref('minAmount')),
        search: Joi.string()
    })
};

// Budget Schemas
const budgetSchemas = {
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
    }),

    update: Joi.object({
        name: Joi.string(),
        amount: Joi.number()
            .positive(),
        categories: Joi.array().items(
            Joi.object({
                name: Joi.string()
                    .required(),
                amount: Joi.number()
                    .positive()
                    .required()
            })
        ),
        notifications: Joi.object({
            enabled: Joi.boolean(),
            threshold: Joi.number()
                .min(1)
                .max(100),
            frequency: Joi.string()
                .valid('daily', 'weekly', 'monthly', 'on_threshold')
        }),
        endDate: Joi.date()
            .min('now'),
        status: Joi.string()
            .valid('active', 'completed', 'cancelled')
    })
};

// WhatsApp Message Schemas
const whatsappSchemas = {
    message: Joi.object({
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

// Admin Schemas
const adminSchemas = {
    settings: Joi.object({
        maintenance: Joi.boolean(),
        backupSchedule: Joi.string()
            .pattern(/^((\d+,)*\d+|(\d+(\/|-)\d+)|(\*)|(\d+))(\s+(\d+,)*\d+|(\d+(\/|-)\d+)|(\*)|(\d+)){4}$/),
        rateLimiting: Joi.object({
            enabled: Joi.boolean(),
            windowMs: Joi.number()
                .positive(),
            max: Joi.number()
                .positive()
        }),
        logging: Joi.object({
            level: Joi.string()
                .valid('error', 'warn', 'info', 'debug'),
            retention: Joi.number()
                .positive()
        })
    }),

    backup: Joi.object({
        type: Joi.string()
            .valid('full', 'incremental')
            .default('full'),
        compress: Joi.boolean()
            .default(true),
        includeFiles: Joi.boolean()
            .default(true)
    })
};

// Common Schemas
const commonSchemas = {
    pagination: Joi.object({
        page: Joi.number()
            .integer()
            .min(1)
            .default(1),
        limit: Joi.number()
            .integer()
            .min(1)
            .max(100)
            .default(10),
        sort: Joi.string(),
        order: Joi.string()
            .valid('asc', 'desc')
            .default('desc')
    }),

    dateRange: Joi.object({
        startDate: Joi.date()
            .required(),
        endDate: Joi.date()
            .min(Joi.ref('startDate'))
            .required()
    })
};

// Validation function with i18n support
const validate = (schema, data, locale = 'id') => {
    const options = {
        messages: messages,
        errors: {
            wrap: {
                label: ''
            }
        }
    };

    const { error, value } = schema.validate(data, options);

    if (error) {
        const translatedError = error.details.map(detail => ({
            ...detail,
            message: i18n.translate(`errors.${detail.type}`, locale, {
                field: detail.context.label,
                ...detail.context
            })
        }));

        return {
            error: translatedError,
            value: null
        };
    }

    return {
        error: null,
        value
    };
};

module.exports = {
    patterns,
    userSchemas,
    transactionSchemas,
    budgetSchemas,
    whatsappSchemas,
    adminSchemas,
    commonSchemas,
    validate
};

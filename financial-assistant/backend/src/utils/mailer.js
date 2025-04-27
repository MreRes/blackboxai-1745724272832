const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs').promises;
const Handlebars = require('handlebars');
const logger = require('./logger');
const i18n = require('./i18n');
const formatter = require('./formatter');

class Mailer {
    constructor() {
        this.transporter = null;
        this.templates = {};
        this.defaultLocale = 'id';

        // Initialize mailer
        this.initialize();
    }

    // Initialize mailer
    async initialize() {
        try {
            // Create transporter
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });

            // Load email templates
            await this.loadTemplates();

            // Verify connection
            await this.verifyConnection();

            logger.info('Email service initialized successfully');
        } catch (error) {
            logger.error(error, { type: 'mailer_initialization_error' });
            throw error;
        }
    }

    // Load email templates
    async loadTemplates() {
        try {
            const templatesDir = path.join(__dirname, '../templates/email');
            const templates = await fs.readdir(templatesDir);

            for (const template of templates) {
                const [name, locale] = path.basename(template, '.hbs').split('.');
                const content = await fs.readFile(
                    path.join(templatesDir, template),
                    'utf8'
                );

                if (!this.templates[name]) {
                    this.templates[name] = {};
                }

                this.templates[name][locale || this.defaultLocale] = Handlebars.compile(content);
            }

            // Register partials
            const partialsDir = path.join(templatesDir, 'partials');
            const partials = await fs.readdir(partialsDir);

            for (const partial of partials) {
                const name = path.basename(partial, '.hbs');
                const content = await fs.readFile(
                    path.join(partialsDir, partial),
                    'utf8'
                );
                Handlebars.registerPartial(name, content);
            }

            // Register helpers
            Handlebars.registerHelper('formatDate', function(date, format) {
                return formatter.formatDate(date, format);
            });

            Handlebars.registerHelper('formatCurrency', function(amount) {
                return formatter.formatCurrency(amount);
            });

            Handlebars.registerHelper('translate', function(key, locale) {
                return i18n.translate(key, locale);
            });

        } catch (error) {
            logger.error(error, { type: 'template_loading_error' });
            throw error;
        }
    }

    // Verify email connection
    async verifyConnection() {
        try {
            await this.transporter.verify();
            logger.info('Email connection verified');
        } catch (error) {
            logger.error(error, { type: 'email_verification_error' });
            throw error;
        }
    }

    // Send email
    async sendMail(options) {
        try {
            const result = await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                ...options
            });

            logger.info('Email sent successfully', {
                messageId: result.messageId,
                to: options.to
            });

            return result;
        } catch (error) {
            logger.error(error, {
                type: 'email_send_error',
                to: options.to
            });
            throw error;
        }
    }

    // Send template email
    async sendTemplate(template, to, data, locale = this.defaultLocale) {
        try {
            if (!this.templates[template]) {
                throw new Error(`Template not found: ${template}`);
            }

            // Get template for locale or fallback to default
            const templateFn = this.templates[template][locale] || 
                             this.templates[template][this.defaultLocale];

            if (!templateFn) {
                throw new Error(`No template found for ${template}`);
            }

            // Render template
            const html = templateFn({
                ...data,
                locale
            });

            // Send email
            return await this.sendMail({
                to,
                subject: i18n.translate(`email.${template}.subject`, locale, data),
                html
            });
        } catch (error) {
            logger.error(error, {
                type: 'template_email_error',
                template,
                to
            });
            throw error;
        }
    }

    // Send welcome email
    async sendWelcomeEmail(user) {
        return await this.sendTemplate('welcome', user.email, {
            username: user.username
        });
    }

    // Send activation code
    async sendActivationCode(user, code) {
        return await this.sendTemplate('activation', user.email, {
            username: user.username,
            code,
            expiryDate: user.expiryDate
        });
    }

    // Send password reset
    async sendPasswordReset(user, token) {
        return await this.sendTemplate('password-reset', user.email, {
            username: user.username,
            resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${token}`
        });
    }

    // Send transaction receipt
    async sendTransactionReceipt(user, transaction) {
        return await this.sendTemplate('transaction-receipt', user.email, {
            username: user.username,
            transaction: {
                ...transaction,
                formattedAmount: formatter.formatCurrency(transaction.amount),
                formattedDate: formatter.formatDate(transaction.date)
            }
        });
    }

    // Send budget alert
    async sendBudgetAlert(user, budget) {
        return await this.sendTemplate('budget-alert', user.email, {
            username: user.username,
            budget: {
                ...budget,
                formattedAmount: formatter.formatCurrency(budget.amount),
                formattedRemaining: formatter.formatCurrency(budget.remaining)
            }
        });
    }

    // Send monthly report
    async sendMonthlyReport(user, report) {
        return await this.sendTemplate('monthly-report', user.email, {
            username: user.username,
            report: {
                ...report,
                formattedIncome: formatter.formatCurrency(report.income),
                formattedExpense: formatter.formatCurrency(report.expense),
                formattedBalance: formatter.formatCurrency(report.balance)
            }
        });
    }

    // Send subscription expiry notice
    async sendSubscriptionExpiry(user) {
        const daysLeft = Math.ceil(
            (user.expiryDate - new Date()) / (1000 * 60 * 60 * 24)
        );

        return await this.sendTemplate('subscription-expiry', user.email, {
            username: user.username,
            daysLeft,
            expiryDate: formatter.formatDate(user.expiryDate)
        });
    }

    // Send system alert
    async sendSystemAlert(admin, alert) {
        return await this.sendTemplate('system-alert', admin.email, {
            username: admin.username,
            alert: {
                ...alert,
                timestamp: formatter.formatDate(new Date(), 'full')
            }
        });
    }

    // Get template preview
    getTemplatePreview(template, data = {}, locale = this.defaultLocale) {
        try {
            if (!this.templates[template]) {
                throw new Error(`Template not found: ${template}`);
            }

            const templateFn = this.templates[template][locale] || 
                             this.templates[template][this.defaultLocale];

            if (!templateFn) {
                throw new Error(`No template found for ${template}`);
            }

            return templateFn({
                ...data,
                locale,
                preview: true
            });
        } catch (error) {
            logger.error(error, {
                type: 'template_preview_error',
                template
            });
            throw error;
        }
    }

    // Get available templates
    getAvailableTemplates() {
        return Object.keys(this.templates).map(name => ({
            name,
            locales: Object.keys(this.templates[name])
        }));
    }
}

module.exports = new Mailer();

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const cache = require('./cache');

class I18n {
    constructor() {
        this.translations = {};
        this.defaultLocale = 'id'; // Indonesian as default
        this.fallbackLocale = 'en'; // English as fallback
        this.supportedLocales = ['id', 'en'];
        
        // Initialize translations
        this.initialize();
    }

    // Initialize translations
    async initialize() {
        try {
            // Load translations for all supported locales
            for (const locale of this.supportedLocales) {
                this.translations[locale] = await this.loadTranslations(locale);
            }

            logger.info('Translations loaded successfully', {
                locales: Object.keys(this.translations)
            });
        } catch (error) {
            logger.error(error, { type: 'i18n_initialization_error' });
            throw error;
        }
    }

    // Load translations for a specific locale
    async loadTranslations(locale) {
        try {
            // Try to get from cache first
            const cached = await cache.get(`translations:${locale}`);
            if (cached) return cached;

            // Load from file if not in cache
            const filePath = path.join(__dirname, '../locales', `${locale}.json`);
            const content = await fs.readFile(filePath, 'utf8');
            const translations = JSON.parse(content);

            // Cache translations
            await cache.set(`translations:${locale}`, translations, 3600); // Cache for 1 hour

            return translations;
        } catch (error) {
            logger.error(error, { type: 'translation_load_error', locale });
            throw error;
        }
    }

    // Translate a key
    translate(key, locale = this.defaultLocale, params = {}) {
        try {
            // Get translations for requested locale
            const translations = this.translations[locale] || this.translations[this.fallbackLocale];
            if (!translations) {
                throw new Error(`No translations found for locale: ${locale}`);
            }

            // Get translation
            let translation = this.getNestedTranslation(translations, key);

            // Fallback to default locale if translation not found
            if (!translation && locale !== this.fallbackLocale) {
                translation = this.getNestedTranslation(
                    this.translations[this.fallbackLocale],
                    key
                );
            }

            // Return key if no translation found
            if (!translation) {
                logger.warn('Translation not found', { key, locale });
                return key;
            }

            // Replace parameters
            return this.replaceParams(translation, params);
        } catch (error) {
            logger.error(error, { type: 'translation_error', key, locale });
            return key;
        }
    }

    // Get nested translation using dot notation
    getNestedTranslation(translations, key) {
        return key.split('.').reduce((obj, k) => obj?.[k], translations);
    }

    // Replace parameters in translation
    replaceParams(text, params) {
        return text.replace(/{(\w+)}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    // Format number according to locale
    formatNumber(number, locale = this.defaultLocale, options = {}) {
        try {
            return new Intl.NumberFormat(locale, options).format(number);
        } catch (error) {
            logger.error(error, { type: 'number_format_error', locale });
            return number.toString();
        }
    }

    // Format currency according to locale
    formatCurrency(amount, locale = this.defaultLocale, currency = 'IDR') {
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency
            }).format(amount);
        } catch (error) {
            logger.error(error, { type: 'currency_format_error', locale });
            return amount.toString();
        }
    }

    // Format date according to locale
    formatDate(date, locale = this.defaultLocale, options = {}) {
        try {
            return new Intl.DateTimeFormat(locale, options).format(date);
        } catch (error) {
            logger.error(error, { type: 'date_format_error', locale });
            return date.toISOString();
        }
    }

    // Get plural form
    getPlural(count, forms, locale = this.defaultLocale) {
        try {
            const rules = this.getPluralRules(locale);
            const category = rules.select(count);
            return forms[category] || forms.other;
        } catch (error) {
            logger.error(error, { type: 'plural_format_error', locale });
            return forms.other;
        }
    }

    // Get plural rules for locale
    getPluralRules(locale) {
        return new Intl.PluralRules(locale);
    }

    // Express middleware for handling localization
    middleware() {
        return (req, res, next) => {
            // Get locale from query parameter, header, or default
            const locale = req.query.locale || 
                         req.headers['accept-language']?.split(',')[0] || 
                         this.defaultLocale;

            // Set locale for request
            req.locale = this.supportedLocales.includes(locale) ? locale : this.defaultLocale;

            // Add translation helper to response locals
            res.locals.t = (key, params = {}) => this.translate(key, req.locale, params);
            res.locals.formatNumber = (number, options = {}) => this.formatNumber(number, req.locale, options);
            res.locals.formatCurrency = (amount, currency = 'IDR') => this.formatCurrency(amount, req.locale, currency);
            res.locals.formatDate = (date, options = {}) => this.formatDate(date, req.locale, options);

            next();
        };
    }

    // Add new translations
    async addTranslations(locale, translations) {
        try {
            // Merge with existing translations
            this.translations[locale] = {
                ...this.translations[locale],
                ...translations
            };

            // Update cache
            await cache.set(`translations:${locale}`, this.translations[locale], 3600);

            // Save to file
            const filePath = path.join(__dirname, '../locales', `${locale}.json`);
            await fs.writeFile(
                filePath,
                JSON.stringify(this.translations[locale], null, 2)
            );

            logger.info('Translations added successfully', { locale });
            return true;
        } catch (error) {
            logger.error(error, { type: 'add_translations_error', locale });
            return false;
        }
    }

    // Remove translations
    async removeTranslations(locale, keys) {
        try {
            // Remove specified keys
            for (const key of keys) {
                const parts = key.split('.');
                let current = this.translations[locale];
                for (let i = 0; i < parts.length - 1; i++) {
                    current = current[parts[i]];
                }
                delete current[parts[parts.length - 1]];
            }

            // Update cache
            await cache.set(`translations:${locale}`, this.translations[locale], 3600);

            // Save to file
            const filePath = path.join(__dirname, '../locales', `${locale}.json`);
            await fs.writeFile(
                filePath,
                JSON.stringify(this.translations[locale], null, 2)
            );

            logger.info('Translations removed successfully', { locale, keys });
            return true;
        } catch (error) {
            logger.error(error, { type: 'remove_translations_error', locale });
            return false;
        }
    }

    // Get missing translations
    getMissingTranslations(sourceLocale = this.defaultLocale) {
        const missing = {};
        const sourceTranslations = this.translations[sourceLocale];

        for (const locale of this.supportedLocales) {
            if (locale === sourceLocale) continue;

            missing[locale] = [];
            this.findMissingKeys(
                sourceTranslations,
                this.translations[locale],
                '',
                missing[locale]
            );
        }

        return missing;
    }

    // Helper function to find missing keys
    findMissingKeys(source, target, prefix, missing) {
        for (const key in source) {
            const currentKey = prefix ? `${prefix}.${key}` : key;
            if (typeof source[key] === 'object') {
                if (!target[key]) {
                    missing.push(currentKey);
                } else {
                    this.findMissingKeys(source[key], target[key], currentKey, missing);
                }
            } else if (!target || !(key in target)) {
                missing.push(currentKey);
            }
        }
    }

    // Validate translations
    validateTranslations() {
        const issues = {};
        const sourceTranslations = this.translations[this.defaultLocale];

        for (const locale of this.supportedLocales) {
            if (locale === this.defaultLocale) continue;

            issues[locale] = [];
            this.findTranslationIssues(
                sourceTranslations,
                this.translations[locale],
                '',
                issues[locale]
            );
        }

        return issues;
    }

    // Helper function to find translation issues
    findTranslationIssues(source, target, prefix, issues) {
        for (const key in source) {
            const currentKey = prefix ? `${prefix}.${key}` : key;
            if (typeof source[key] === 'object') {
                if (!target[key] || typeof target[key] !== 'object') {
                    issues.push({
                        key: currentKey,
                        type: 'missing_object'
                    });
                } else {
                    this.findTranslationIssues(source[key], target[key], currentKey, issues);
                }
            } else if (!target || !(key in target)) {
                issues.push({
                    key: currentKey,
                    type: 'missing_translation'
                });
            } else if (typeof target[key] !== typeof source[key]) {
                issues.push({
                    key: currentKey,
                    type: 'type_mismatch'
                });
            }
        }
    }
}

module.exports = new I18n();

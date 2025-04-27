const crypto = require('crypto');
const moment = require('moment');
const formatter = require('./formatter');
const logger = require('./logger');

class Helpers {
    // Generate random string
    generateRandomString(length = 8, type = 'alphanumeric') {
        let chars;
        switch (type) {
            case 'numeric':
                chars = '0123456789';
                break;
            case 'alphabetic':
                chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
                break;
            case 'alphanumeric':
            default:
                chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                break;
        }

        let result = '';
        const randomBytes = crypto.randomBytes(length);
        for (let i = 0; i < length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }
        return result;
    }

    // Generate activation code
    generateActivationCode() {
        return this.generateRandomString(8, 'alphanumeric').toUpperCase();
    }

    // Generate reference number
    generateReferenceNumber(prefix = 'TRX') {
        const timestamp = moment().format('YYMMDDHHmmss');
        const random = this.generateRandomString(4, 'numeric');
        return `${prefix}${timestamp}${random}`;
    }

    // Deep clone object
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // Remove empty properties from object
    removeEmpty(obj) {
        return Object.entries(obj)
            .filter(([_, v]) => v != null)
            .reduce((acc, [k, v]) => ({
                ...acc,
                [k]: v === Object(v) ? this.removeEmpty(v) : v
            }), {});
    }

    // Chunk array into smaller arrays
    chunk(array, size) {
        return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
            array.slice(i * size, i * size + size)
        );
    }

    // Sleep function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Retry function with exponential backoff
    async retry(fn, options = {}) {
        const {
            retries = 3,
            initialDelay = 1000,
            maxDelay = 10000,
            factor = 2,
            onRetry = null
        } = options;

        let attempt = 0;
        let delay = initialDelay;

        while (attempt < retries) {
            try {
                return await fn();
            } catch (error) {
                attempt++;
                if (attempt === retries) throw error;

                if (onRetry) {
                    onRetry(error, attempt);
                }

                await this.sleep(delay);
                delay = Math.min(delay * factor, maxDelay);
            }
        }
    }

    // Parse duration string to milliseconds
    parseDuration(duration) {
        const regex = /^(\d+)([smhdw])$/;
        const match = duration.match(regex);
        if (!match) throw new Error('Invalid duration format');

        const [, value, unit] = match;
        const multipliers = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000
        };

        return parseInt(value) * multipliers[unit];
    }

    // Format bytes to human readable size
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // Calculate date ranges
    getDateRange(period = 'month') {
        const now = moment();
        let start, end;

        switch (period) {
            case 'day':
                start = now.startOf('day');
                end = now.endOf('day');
                break;
            case 'week':
                start = now.startOf('week');
                end = now.endOf('week');
                break;
            case 'month':
                start = now.startOf('month');
                end = now.endOf('month');
                break;
            case 'year':
                start = now.startOf('year');
                end = now.endOf('year');
                break;
            default:
                throw new Error('Invalid period');
        }

        return { start: start.toDate(), end: end.toDate() };
    }

    // Calculate percentage
    calculatePercentage(value, total, decimals = 2) {
        if (total === 0) return 0;
        return parseFloat(((value / total) * 100).toFixed(decimals));
    }

    // Calculate growth rate
    calculateGrowth(current, previous, decimals = 2) {
        if (previous === 0) return null;
        return parseFloat((((current - previous) / previous) * 100).toFixed(decimals));
    }

    // Group array by key
    groupBy(array, key) {
        return array.reduce((result, item) => ({
            ...result,
            [item[key]]: [...(result[item[key]] || []), item]
        }), {});
    }

    // Sort array by multiple keys
    sortBy(array, keys) {
        return array.sort((a, b) => {
            for (const key of keys) {
                const desc = key.startsWith('-');
                const k = desc ? key.substr(1) : key;
                const modifier = desc ? -1 : 1;

                if (a[k] < b[k]) return -1 * modifier;
                if (a[k] > b[k]) return 1 * modifier;
            }
            return 0;
        });
    }

    // Calculate moving average
    calculateMovingAverage(data, period) {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const slice = data.slice(i - period + 1, i + 1);
            const average = slice.reduce((sum, val) => sum + val, 0) / period;
            result.push(average);
        }
        return result;
    }

    // Generate summary statistics
    calculateStats(numbers) {
        const sorted = [...numbers].sort((a, b) => a - b);
        const sum = sorted.reduce((acc, val) => acc + val, 0);
        const count = sorted.length;
        const mean = sum / count;

        const median = count % 2 === 0
            ? (sorted[count/2 - 1] + sorted[count/2]) / 2
            : sorted[Math.floor(count/2)];

        const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
        const stdDev = Math.sqrt(variance);

        return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            sum,
            count,
            mean,
            median,
            variance,
            stdDev
        };
    }

    // Parse boolean
    parseBoolean(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.toLowerCase().trim();
            return ['true', '1', 'yes', 'on'].includes(normalized);
        }
        return Boolean(value);
    }

    // Validate Indonesian phone number
    validatePhoneNumber(phone) {
        const regex = /^(?:\+62|62|0)(?:\d{8,15})$/;
        return regex.test(phone);
    }

    // Format phone number to E.164 format
    formatPhoneNumber(phone) {
        if (!phone) return null;

        // Remove any non-digit characters
        phone = phone.replace(/\D/g, '');

        // Ensure number starts with country code
        if (phone.startsWith('0')) {
            phone = '62' + phone.substring(1);
        } else if (!phone.startsWith('62')) {
            phone = '62' + phone;
        }

        return phone;
    }

    // Validate email
    validateEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    // Generate slug
    generateSlug(text) {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-');
    }

    // Parse query parameters
    parseQueryParams(query) {
        const result = {};

        for (const [key, value] of Object.entries(query)) {
            // Handle special keys
            if (['page', 'limit'].includes(key)) {
                result[key] = parseInt(value) || undefined;
                continue;
            }

            // Handle JSON strings
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                try {
                    result[key] = JSON.parse(value);
                    continue;
                } catch (e) {
                    // If parsing fails, use original value
                }
            }

            // Handle dates
            if (key.toLowerCase().includes('date')) {
                const date = moment(value);
                if (date.isValid()) {
                    result[key] = date.toDate();
                    continue;
                }
            }

            // Handle booleans
            if (['true', 'false'].includes(value)) {
                result[key] = value === 'true';
                continue;
            }

            // Handle numbers
            if (!isNaN(value)) {
                result[key] = Number(value);
                continue;
            }

            // Default
            result[key] = value;
        }

        return result;
    }

    // Generate pagination info
    getPaginationInfo(page, limit, total) {
        const totalPages = Math.ceil(total / limit);
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const skip = (currentPage - 1) * limit;

        return {
            currentPage,
            totalPages,
            totalItems: total,
            itemsPerPage: limit,
            skip,
            hasNextPage: currentPage < totalPages,
            hasPrevPage: currentPage > 1
        };
    }

    // Safe JSON parse
    safeJSONParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch (e) {
            logger.error(e, { type: 'json_parse_error', data: str });
            return fallback;
        }
    }

    // Safe JSON stringify
    safeJSONStringify(obj, fallback = '{}') {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            logger.error(e, { type: 'json_stringify_error', data: obj });
            return fallback;
        }
    }
}

module.exports = new Helpers();

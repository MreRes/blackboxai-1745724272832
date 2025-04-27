const moment = require('moment');
require('moment/locale/id'); // Set Indonesian locale
moment.locale('id');

class Formatter {
    constructor() {
        // Initialize currency formatter
        this.currencyFormatter = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });

        // Common date formats
        this.dateFormats = {
            short: 'DD/MM/YYYY',
            long: 'D MMMM YYYY',
            full: 'dddd, D MMMM YYYY',
            time: 'HH:mm',
            datetime: 'DD/MM/YYYY HH:mm',
            datetimeFull: 'dddd, D MMMM YYYY HH:mm',
            month: 'MMMM YYYY',
            monthShort: 'MMM YYYY'
        };

        // Initialize number formatter
        this.numberFormatter = new Intl.NumberFormat('id-ID');
    }

    // Currency formatting
    formatCurrency(amount, options = {}) {
        const { withSymbol = true, compact = false } = options;

        if (compact && Math.abs(amount) >= 1000000) {
            const millions = amount / 1000000;
            return `${withSymbol ? 'Rp ' : ''}${millions.toFixed(1)}M`;
        }

        if (compact && Math.abs(amount) >= 1000) {
            const thousands = amount / 1000;
            return `${withSymbol ? 'Rp ' : ''}${thousands.toFixed(1)}K`;
        }

        const formatted = this.currencyFormatter.format(amount);
        return withSymbol ? formatted : formatted.replace('Rp', '').trim();
    }

    // Date formatting
    formatDate(date, format = 'short') {
        if (!date) return '';
        return moment(date).format(this.dateFormats[format] || format);
    }

    // Time ago
    timeAgo(date) {
        return moment(date).fromNow();
    }

    // Number formatting
    formatNumber(number, options = {}) {
        const { decimals = 0, compact = false } = options;

        if (compact) {
            if (number >= 1000000) {
                return `${(number / 1000000).toFixed(1)}M`;
            }
            if (number >= 1000) {
                return `${(number / 1000).toFixed(1)}K`;
            }
        }

        return this.numberFormatter.format(Number(number).toFixed(decimals));
    }

    // Percentage formatting
    formatPercentage(value, decimals = 1) {
        return `${Number(value).toFixed(decimals)}%`;
    }

    // Phone number formatting
    formatPhoneNumber(phone) {
        if (!phone) return '';

        // Remove any non-digit characters
        phone = phone.replace(/\D/g, '');

        // Ensure number starts with proper country code
        if (phone.startsWith('0')) {
            phone = '62' + phone.substring(1);
        } else if (!phone.startsWith('62')) {
            phone = '62' + phone;
        }

        // Format: +62 812-3456-7890
        return phone.replace(/(\d{2})(\d{3})(\d{4})(\d{4})/, '+$1 $2-$3-$4');
    }

    // Category formatting
    formatCategory(category) {
        return category
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    // Transaction type formatting
    formatTransactionType(type, capitalize = true) {
        const types = {
            income: 'pemasukan',
            expense: 'pengeluaran'
        };

        const formatted = types[type] || type;
        return capitalize ? 
            formatted.charAt(0).toUpperCase() + formatted.slice(1) : 
            formatted;
    }

    // Budget period formatting
    formatBudgetPeriod(period) {
        const periods = {
            daily: 'Harian',
            weekly: 'Mingguan',
            monthly: 'Bulanan',
            yearly: 'Tahunan',
            custom: 'Kustom'
        };

        return periods[period] || period;
    }

    // File size formatting
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // Duration formatting
    formatDuration(minutes) {
        if (minutes < 60) {
            return `${minutes} menit`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        if (remainingMinutes === 0) {
            return `${hours} jam`;
        }
        return `${hours} jam ${remainingMinutes} menit`;
    }

    // List formatting
    formatList(items, conjunction = 'dan') {
        if (!Array.isArray(items) || items.length === 0) return '';
        if (items.length === 1) return items[0];
        if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
        
        return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
    }

    // Range formatting
    formatRange(start, end, format = 'short') {
        const startDate = this.formatDate(start, format);
        const endDate = this.formatDate(end, format);
        return `${startDate} - ${endDate}`;
    }

    // Status formatting
    formatStatus(status) {
        const statuses = {
            active: 'Aktif',
            completed: 'Selesai',
            cancelled: 'Dibatalkan',
            pending: 'Menunggu',
            expired: 'Kadaluarsa'
        };

        return statuses[status] || status;
    }

    // Score formatting
    formatScore(score, maxScore = 100) {
        const percentage = (score / maxScore) * 100;
        let grade;

        if (percentage >= 90) grade = 'A';
        else if (percentage >= 80) grade = 'B';
        else if (percentage >= 70) grade = 'C';
        else if (percentage >= 60) grade = 'D';
        else grade = 'E';

        return {
            score,
            percentage: this.formatPercentage(percentage),
            grade
        };
    }

    // Error message formatting
    formatError(error) {
        if (typeof error === 'string') return error;

        const messages = {
            INVALID_INPUT: 'Input tidak valid',
            NOT_FOUND: 'Data tidak ditemukan',
            UNAUTHORIZED: 'Akses ditolak',
            FORBIDDEN: 'Tidak memiliki izin',
            INTERNAL_ERROR: 'Terjadi kesalahan sistem'
        };

        return messages[error.code] || error.message || 'Terjadi kesalahan';
    }

    // WhatsApp message formatting
    formatWhatsAppMessage(message, data = {}) {
        // Replace placeholders with actual data
        return message.replace(/\{(\w+)\}/g, (match, key) => {
            if (key in data) {
                // Format based on data type
                if (typeof data[key] === 'number') {
                    return this.formatNumber(data[key]);
                }
                if (data[key] instanceof Date) {
                    return this.formatDate(data[key]);
                }
                return data[key];
            }
            return match;
        });
    }

    // Notification message formatting
    formatNotification(type, data = {}) {
        const templates = {
            budgetAlert: `Budget {category} Anda telah mencapai {percentage}%. Sisa budget: {remaining}`,
            transactionCreated: `{type} sebesar {amount} untuk {category} berhasil dicatat`,
            subscriptionExpiry: `Langganan Anda akan berakhir dalam {days} hari`,
            systemAlert: `[{severity}] {message}`
        };

        return this.formatWhatsAppMessage(templates[type] || '', data);
    }
}

module.exports = new Formatter();

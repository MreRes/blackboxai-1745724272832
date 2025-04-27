const whatsapp = require('../config/whatsapp');
const logger = require('./logger');
const validator = require('./validator');

class Notifier {
    constructor() {
        this.notificationQueue = [];
        this.isProcessing = false;
        this.retryAttempts = 3;
        this.retryDelay = 5000; // 5 seconds

        // Initialize notification templates
        this.templates = {
            budgetAlert: (data) => ({
                message: `⚠️ *Peringatan Budget*\n\n` +
                    `Budget ${data.category} Anda telah mencapai ${data.percentage}%\n` +
                    `Sisa budget: ${validator.formatCurrency(data.remaining)}\n` +
                    `Periode: ${validator.formatDate(data.startDate)} - ${validator.formatDate(data.endDate)}`
            }),

            transactionConfirmation: (data) => ({
                message: `✅ *Transaksi Berhasil*\n\n` +
                    `Tipe: ${data.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}\n` +
                    `Jumlah: ${validator.formatCurrency(data.amount)}\n` +
                    `Kategori: ${data.category}\n` +
                    `Tanggal: ${validator.formatDate(data.date)}\n` +
                    (data.description ? `Deskripsi: ${data.description}\n` : '')
            }),

            subscriptionExpiry: (data) => ({
                message: `📅 *Pemberitahuan Langganan*\n\n` +
                    `Langganan Anda akan berakhir dalam ${data.daysLeft} hari.\n` +
                    `Tanggal berakhir: ${validator.formatDate(data.expiryDate)}\n\n` +
                    `Silakan hubungi admin untuk perpanjangan.`
            }),

            dailyReport: (data) => ({
                message: `📊 *Laporan Harian*\n\n` +
                    `Tanggal: ${validator.formatDate(data.date)}\n\n` +
                    `Pemasukan: ${validator.formatCurrency(data.income)}\n` +
                    `Pengeluaran: ${validator.formatCurrency(data.expense)}\n` +
                    `Saldo: ${validator.formatCurrency(data.balance)}\n\n` +
                    `Top Kategori Pengeluaran:\n` +
                    data.topExpenses.map(exp => 
                        `- ${exp.category}: ${validator.formatCurrency(exp.amount)}`
                    ).join('\n')
            }),

            monthlyReport: (data) => ({
                message: `📈 *Laporan Bulanan*\n\n` +
                    `Periode: ${data.month}\n\n` +
                    `Total Pemasukan: ${validator.formatCurrency(data.income)}\n` +
                    `Total Pengeluaran: ${validator.formatCurrency(data.expense)}\n` +
                    `Saldo: ${validator.formatCurrency(data.balance)}\n\n` +
                    `Ringkasan Budget:\n` +
                    data.budgets.map(budget => 
                        `- ${budget.name}: ${Math.round(budget.progress)}%`
                    ).join('\n')
            }),

            systemAlert: (data) => ({
                message: `🚨 *System Alert*\n\n` +
                    `Type: ${data.type}\n` +
                    `Message: ${data.message}\n` +
                    `Time: ${new Date().toISOString()}`
            })
        };
    }

    // Add notification to queue
    async queueNotification(type, recipient, data) {
        try {
            const template = this.templates[type];
            if (!template) {
                throw new Error(`Invalid notification type: ${type}`);
            }

            const notification = {
                id: Date.now().toString(),
                recipient,
                ...template(data),
                attempts: 0,
                timestamp: new Date()
            };

            this.notificationQueue.push(notification);
            logger.info('Notification queued', { type, recipient });

            // Start processing if not already running
            if (!this.isProcessing) {
                this.processQueue();
            }

            return {
                success: true,
                notificationId: notification.id
            };
        } catch (error) {
            logger.error(error, { type: 'notification_queue_error' });
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Process notification queue
    async processQueue() {
        if (this.isProcessing || this.notificationQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.notificationQueue.length > 0) {
                const notification = this.notificationQueue[0];

                const success = await this.sendNotification(notification);
                
                if (success) {
                    // Remove from queue if successful
                    this.notificationQueue.shift();
                } else {
                    // Move to end of queue for retry if failed
                    if (notification.attempts < this.retryAttempts) {
                        notification.attempts++;
                        this.notificationQueue.push(this.notificationQueue.shift());
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    } else {
                        // Log failure and remove from queue if max attempts reached
                        logger.error('Max retry attempts reached for notification', {
                            notificationId: notification.id,
                            recipient: notification.recipient
                        });
                        this.notificationQueue.shift();
                    }
                }
            }
        } catch (error) {
            logger.error(error, { type: 'notification_process_error' });
        } finally {
            this.isProcessing = false;
        }
    }

    // Send notification via WhatsApp
    async sendNotification(notification) {
        try {
            await whatsapp.sendMessage(notification.recipient, notification.message);
            
            logger.info('Notification sent successfully', {
                notificationId: notification.id,
                recipient: notification.recipient
            });

            return true;
        } catch (error) {
            logger.error(error, {
                type: 'notification_send_error',
                notificationId: notification.id,
                recipient: notification.recipient,
                attempt: notification.attempts + 1
            });

            return false;
        }
    }

    // Send budget alert
    async sendBudgetAlert(userId, budgetData) {
        const User = require('../models/user');
        try {
            const user = await User.findById(userId);
            if (!user || user.phoneNumbers.length === 0) {
                throw new Error('User or phone number not found');
            }

            return await this.queueNotification(
                'budgetAlert',
                user.phoneNumbers[0].number,
                budgetData
            );
        } catch (error) {
            logger.error(error, { type: 'budget_alert_error', userId });
            return { success: false, error: error.message };
        }
    }

    // Send transaction confirmation
    async sendTransactionConfirmation(userId, transactionData) {
        const User = require('../models/user');
        try {
            const user = await User.findById(userId);
            if (!user || user.phoneNumbers.length === 0) {
                throw new Error('User or phone number not found');
            }

            return await this.queueNotification(
                'transactionConfirmation',
                user.phoneNumbers[0].number,
                transactionData
            );
        } catch (error) {
            logger.error(error, { type: 'transaction_confirmation_error', userId });
            return { success: false, error: error.message };
        }
    }

    // Send subscription expiry notification
    async sendSubscriptionAlert(userId) {
        const User = require('../models/user');
        try {
            const user = await User.findById(userId);
            if (!user || user.phoneNumbers.length === 0) {
                throw new Error('User or phone number not found');
            }

            const daysLeft = Math.ceil(
                (user.expiryDate - new Date()) / (1000 * 60 * 60 * 24)
            );

            if (daysLeft <= 7) { // Alert when 7 or fewer days remaining
                return await this.queueNotification(
                    'subscriptionExpiry',
                    user.phoneNumbers[0].number,
                    {
                        daysLeft,
                        expiryDate: user.expiryDate
                    }
                );
            }

            return { success: true, message: 'No alert needed' };
        } catch (error) {
            logger.error(error, { type: 'subscription_alert_error', userId });
            return { success: false, error: error.message };
        }
    }

    // Send daily report
    async sendDailyReport(userId, reportData) {
        const User = require('../models/user');
        try {
            const user = await User.findById(userId);
            if (!user || user.phoneNumbers.length === 0) {
                throw new Error('User or phone number not found');
            }

            return await this.queueNotification(
                'dailyReport',
                user.phoneNumbers[0].number,
                reportData
            );
        } catch (error) {
            logger.error(error, { type: 'daily_report_error', userId });
            return { success: false, error: error.message };
        }
    }

    // Send monthly report
    async sendMonthlyReport(userId, reportData) {
        const User = require('../models/user');
        try {
            const user = await User.findById(userId);
            if (!user || user.phoneNumbers.length === 0) {
                throw new Error('User or phone number not found');
            }

            return await this.queueNotification(
                'monthlyReport',
                user.phoneNumbers[0].number,
                reportData
            );
        } catch (error) {
            logger.error(error, { type: 'monthly_report_error', userId });
            return { success: false, error: error.message };
        }
    }

    // Send system alert to admin
    async sendSystemAlert(type, message) {
        const User = require('../models/user');
        try {
            // Get all admin users
            const admins = await User.find({ isAdmin: true });
            
            const promises = admins.map(admin => {
                if (admin.phoneNumbers.length > 0) {
                    return this.queueNotification(
                        'systemAlert',
                        admin.phoneNumbers[0].number,
                        { type, message }
                    );
                }
                return Promise.resolve();
            });

            await Promise.all(promises);

            return { success: true };
        } catch (error) {
            logger.error(error, { type: 'system_alert_error' });
            return { success: false, error: error.message };
        }
    }
}

module.exports = new Notifier();

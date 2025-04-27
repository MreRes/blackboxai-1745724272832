const cron = require('node-cron');
const moment = require('moment');
const logger = require('./logger');
const notifier = require('./notifier');
const backup = require('../scripts/backup');
const maintenance = require('../scripts/maintenance');
const monitor = require('../scripts/monitor');
const analytics = require('./analytics');
const cache = require('./cache');

class Scheduler {
    constructor() {
        this.jobs = new Map();
        this.initializeJobs();
    }

    // Initialize all scheduled jobs
    initializeJobs() {
        // System maintenance (daily at 2 AM)
        this.addJob('maintenance', '0 2 * * *', this.runMaintenance.bind(this));

        // Database backup (daily at 1 AM)
        this.addJob('backup', '0 1 * * *', this.runBackup.bind(this));

        // System monitoring (every 5 minutes)
        this.addJob('monitor', '*/5 * * * *', this.runMonitoring.bind(this));

        // Cache cleanup (every hour)
        this.addJob('cacheCleanup', '0 * * * *', this.cleanupCache.bind(this));

        // User notifications (daily at 8 AM)
        this.addJob('userNotifications', '0 8 * * *', this.sendUserNotifications.bind(this));

        // Budget alerts (every 6 hours)
        this.addJob('budgetAlerts', '0 */6 * * *', this.checkBudgets.bind(this));

        // Monthly reports (1st day of month at 7 AM)
        this.addJob('monthlyReports', '0 7 1 * *', this.sendMonthlyReports.bind(this));

        // Subscription expiry check (daily at 9 AM)
        this.addJob('subscriptionCheck', '0 9 * * *', this.checkSubscriptions.bind(this));

        // Analytics processing (every 3 hours)
        this.addJob('analytics', '0 */3 * * *', this.processAnalytics.bind(this));
    }

    // Add a new scheduled job
    addJob(name, schedule, task) {
        try {
            if (!cron.validate(schedule)) {
                throw new Error(`Invalid cron schedule: ${schedule}`);
            }

            const job = cron.schedule(schedule, async () => {
                try {
                    logger.info(`Starting scheduled job: ${name}`);
                    await task();
                    logger.info(`Completed scheduled job: ${name}`);
                } catch (error) {
                    logger.error(error, { type: 'scheduled_job_error', job: name });
                    await notifier.sendSystemAlert('error', {
                        type: 'ScheduledJobError',
                        job: name,
                        error: error.message
                    });
                }
            });

            this.jobs.set(name, job);
            logger.info(`Scheduled job registered: ${name} (${schedule})`);
        } catch (error) {
            logger.error(error, { type: 'job_registration_error', job: name });
        }
    }

    // Run system maintenance
    async runMaintenance() {
        const maintenanceScript = new maintenance();
        await maintenanceScript.performMaintenance();
    }

    // Run database backup
    async runBackup() {
        const backupScript = new backup();
        await backupScript.createBackup();
    }

    // Run system monitoring
    async runMonitoring() {
        const monitorScript = new monitor();
        const stats = await monitorScript.generateReport();

        // Check for critical issues
        if (stats.alerts.length > 0) {
            await notifier.sendSystemAlert('warning', {
                type: 'SystemMonitoring',
                alerts: stats.alerts
            });
        }
    }

    // Clean up cache
    async cleanupCache() {
        await cache.maintenance();
    }

    // Send user notifications
    async sendUserNotifications() {
        try {
            const User = require('../models/user');
            const users = await User.find({ 'phoneNumbers.0': { $exists: true } });

            for (const user of users) {
                // Get user's financial overview
                const overview = await analytics.getFinancialOverview(user._id);

                // Send daily summary if enabled
                if (overview.totals.expense > 0) {
                    await notifier.sendDailyReport(user._id, {
                        date: new Date(),
                        income: overview.totals.income,
                        expense: overview.totals.expense,
                        balance: overview.balance,
                        topExpenses: overview.categoryBreakdown.expense || {}
                    });
                }
            }
        } catch (error) {
            logger.error(error, { type: 'user_notifications_error' });
        }
    }

    // Check budgets and send alerts
    async checkBudgets() {
        try {
            const Budget = require('../models/budget');
            const Transaction = require('../models/transaction');

            // Get active budgets
            const budgets = await Budget.find({
                status: 'active',
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            for (const budget of budgets) {
                // Get transactions for this budget period
                const transactions = await Transaction.find({
                    user: budget.user,
                    type: 'expense',
                    category: { $in: budget.categories.map(c => c.name) },
                    date: { $gte: budget.startDate, $lte: budget.endDate }
                });

                // Calculate total spent
                const spent = transactions.reduce((sum, t) => sum + t.amount, 0);
                const percentage = (spent / budget.amount) * 100;

                // Send alert if threshold reached
                if (percentage >= budget.notifications.threshold) {
                    await notifier.sendBudgetAlert(budget.user, {
                        category: budget.name,
                        percentage,
                        remaining: budget.amount - spent,
                        startDate: budget.startDate,
                        endDate: budget.endDate
                    });
                }
            }
        } catch (error) {
            logger.error(error, { type: 'budget_alerts_error' });
        }
    }

    // Send monthly reports
    async sendMonthlyReports() {
        try {
            const User = require('../models/user');
            const users = await User.find({ 'phoneNumbers.0': { $exists: true } });

            const lastMonth = moment().subtract(1, 'month');
            
            for (const user of users) {
                // Get monthly statistics
                const stats = await analytics.getFinancialOverview(user._id, 'monthly');

                // Get budget performance
                const budgetStats = stats.budgetProgress.map(budget => ({
                    name: budget.name,
                    progress: budget.progress
                }));

                // Send report
                await notifier.sendMonthlyReport(user._id, {
                    month: lastMonth.format('MMMM YYYY'),
                    income: stats.totals.income,
                    expense: stats.totals.expense,
                    balance: stats.balance,
                    budgets: budgetStats
                });
            }
        } catch (error) {
            logger.error(error, { type: 'monthly_reports_error' });
        }
    }

    // Check subscription expiry
    async checkSubscriptions() {
        try {
            const User = require('../models/user');
            
            // Find users whose subscription expires in 7 days or less
            const expiryDate = moment().add(7, 'days').endOf('day');
            const users = await User.find({
                expiryDate: { 
                    $lte: expiryDate.toDate(),
                    $gt: new Date()
                }
            });

            // Send notifications
            for (const user of users) {
                await notifier.sendSubscriptionAlert(user._id);
            }
        } catch (error) {
            logger.error(error, { type: 'subscription_check_error' });
        }
    }

    // Process analytics
    async processAnalytics() {
        try {
            const User = require('../models/user');
            const users = await User.find();

            for (const user of users) {
                // Calculate financial health score
                const healthScore = await analytics.getFinancialHealth(user._id);

                // Get spending patterns
                const patterns = await analytics.getSpendingPatterns(user._id);

                // Get budget recommendations
                const recommendations = await analytics.getBudgetRecommendations(user._id);

                // Store results in cache
                await cache.set(`analytics:${user._id}`, {
                    healthScore,
                    patterns,
                    recommendations
                }, 10800); // 3 hours
            }
        } catch (error) {
            logger.error(error, { type: 'analytics_processing_error' });
        }
    }

    // Start all jobs
    startAll() {
        for (const [name, job] of this.jobs) {
            job.start();
            logger.info(`Started scheduled job: ${name}`);
        }
    }

    // Stop all jobs
    stopAll() {
        for (const [name, job] of this.jobs) {
            job.stop();
            logger.info(`Stopped scheduled job: ${name}`);
        }
    }

    // Get job status
    getStatus() {
        const status = [];
        for (const [name, job] of this.jobs) {
            status.push({
                name,
                running: job.running,
                nextRun: this.getNextRun(job)
            });
        }
        return status;
    }

    // Get next run time for a job
    getNextRun(job) {
        try {
            return job.nextDate().toDate();
        } catch (error) {
            return null;
        }
    }

    // Manually run a job
    async runJob(name) {
        const job = this.jobs.get(name);
        if (!job) {
            throw new Error(`Job not found: ${name}`);
        }

        logger.info(`Manually running job: ${name}`);
        await job.execute();
    }
}

module.exports = new Scheduler();

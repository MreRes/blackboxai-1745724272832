const mongoose = require('mongoose');
const { exec } = require('child_process');
const limits = require('../config/limits');
const logger = require('../utils/logger');
const cache = require('../utils/cache');

class SystemOptimizer {
    async optimize() {
        logger.info('Starting system optimization...');

        try {
            await this.cleanupDatabase();
            await this.optimizeIndexes();
            await this.cleanupFiles();
            await this.compressLogs();
            await this.clearCache();
            await this.checkMemory();

            logger.info('System optimization completed successfully');
        } catch (error) {
            logger.error('System optimization failed:', error);
            throw error;
        }
    }

    async cleanupDatabase() {
        logger.info('Cleaning up database...');
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Remove old logs
        await mongoose.connection.collection('logs').deleteMany({
            timestamp: { $lt: thirtyDaysAgo }
        });

        // Remove old notifications
        await mongoose.connection.collection('notifications').deleteMany({
            createdAt: { $lt: thirtyDaysAgo },
            status: 'read'
        });

        // Clean up attachments
        await mongoose.connection.collection('transactions').updateMany(
            {
                'attachments.accessed': { $lt: thirtyDaysAgo }
            },
            {
                $unset: { 'attachments.$[].data': '' }
            }
        );

        // Archive old transactions
        const oldTransactions = await mongoose.connection.collection('transactions')
            .find({ date: { $lt: thirtyDaysAgo } })
            .toArray();

        if (oldTransactions.length > 0) {
            await mongoose.connection.collection('archived_transactions')
                .insertMany(oldTransactions);
            
            await mongoose.connection.collection('transactions')
                .deleteMany({ date: { $lt: thirtyDaysAgo } });
        }
    }

    async optimizeIndexes() {
        logger.info('Optimizing database indexes...');

        const collections = ['transactions', 'users', 'budgets'];
        for (const collection of collections) {
            await mongoose.connection.collection(collection).reIndex();
        }
    }

    async cleanupFiles() {
        logger.info('Cleaning up files...');

        const commands = [
            // Remove old log files
            `find ./logs -type f -mtime +${limits.monitoring.logRetentionDays} -delete`,
            
            // Remove temporary files
            'find /tmp -type f -atime +1 -delete',
            
            // Compress old files
            'find ./uploads -type f -mtime +7 -exec gzip {} \\;'
        ];

        for (const command of commands) {
            await this.executeCommand(command);
        }
    }

    async compressLogs() {
        logger.info('Compressing log files...');

        const commands = [
            // Rotate logs
            'pm2 flush',
            
            // Compress old logs
            'find ./logs -type f -name "*.log" -mtime +1 -exec gzip {} \\;'
        ];

        for (const command of commands) {
            await this.executeCommand(command);
        }
    }

    async clearCache() {
        logger.info('Clearing expired cache entries...');
        
        // Clear application cache
        await cache.maintenance();
        
        // Clear system cache
        const commands = [
            'sync',
            'echo 3 > /proc/sys/vm/drop_caches'
        ];

        for (const command of commands) {
            await this.executeCommand(command);
        }
    }

    async checkMemory() {
        logger.info('Checking memory usage...');

        const used = process.memoryUsage();
        const usage = {
            rss: Math.round(used.rss / 1024 / 1024),
            heapTotal: Math.round(used.heapTotal / 1024 / 1024),
            heapUsed: Math.round(used.heapUsed / 1024 / 1024),
            external: Math.round(used.external / 1024 / 1024)
        };

        logger.info('Memory usage:', usage);

        if (usage.heapUsed > limits.monitoring.alertThreshold) {
            if (global.gc) {
                global.gc();
                logger.info('Garbage collection triggered');
            }
        }
    }

    executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`Command execution failed: ${command}`, error);
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}

// Run optimizer if called directly
if (require.main === module) {
    const optimizer = new SystemOptimizer();
    optimizer.optimize()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Optimization failed:', error);
            process.exit(1);
        });
}

module.exports = new SystemOptimizer();

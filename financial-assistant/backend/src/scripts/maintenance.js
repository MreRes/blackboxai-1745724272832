require('dotenv').config();
const mongoose = require('mongoose');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class SystemMaintenance {
    constructor() {
        this.tasks = [];
        this.maintenanceMode = false;
    }

    async performMaintenance() {
        try {
            console.log('Starting system maintenance...');
            
            // Enable maintenance mode
            await this.enableMaintenanceMode();

            // Perform maintenance tasks
            await this.cleanupLogs();
            await this.optimizeDatabase();
            await this.cleanupSessions();
            await this.cleanupUploads();
            await this.cleanupTempFiles();
            await this.validateData();
            await this.updateIndexes();
            await this.checkIntegrity();

            // Generate maintenance report
            await this.generateReport();

        } catch (error) {
            console.error('Maintenance failed:', error);
            throw error;
        } finally {
            // Disable maintenance mode
            await this.disableMaintenanceMode();
        }
    }

    async enableMaintenanceMode() {
        console.log('Enabling maintenance mode...');
        this.maintenanceMode = true;
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        // Store maintenance status in database
        await mongoose.connection.db.collection('system_status').updateOne(
            { _id: 'maintenance' },
            { 
                $set: { 
                    active: true,
                    startedAt: new Date(),
                    message: process.env.MAINTENANCE_MESSAGE || 'System under maintenance'
                }
            },
            { upsert: true }
        );

        this.addTask('Maintenance Mode', true, 'Enabled maintenance mode');
    }

    async disableMaintenanceMode() {
        console.log('Disabling maintenance mode...');
        this.maintenanceMode = false;

        try {
            await mongoose.connection.db.collection('system_status').updateOne(
                { _id: 'maintenance' },
                { 
                    $set: { 
                        active: false,
                        completedAt: new Date()
                    }
                }
            );

            this.addTask('Maintenance Mode', true, 'Disabled maintenance mode');
        } catch (error) {
            console.error('Error disabling maintenance mode:', error);
            this.addTask('Maintenance Mode', false, 'Failed to disable maintenance mode');
        }
    }

    async cleanupLogs() {
        console.log('Cleaning up logs...');
        try {
            // Remove old system logs
            const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 30;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            await mongoose.connection.db.collection('system_logs').deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            // Clean up log files
            const logDir = process.env.LOG_PATH || './logs';
            const files = await fs.readdir(logDir);
            
            for (const file of files) {
                const filePath = path.join(logDir, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime < cutoffDate) {
                    await fs.unlink(filePath);
                }
            }

            this.addTask('Log Cleanup', true, `Removed logs older than ${retentionDays} days`);
        } catch (error) {
            console.error('Error cleaning up logs:', error);
            this.addTask('Log Cleanup', false, error.message);
        }
    }

    async optimizeDatabase() {
        console.log('Optimizing database...');
        try {
            // Run MongoDB compact command on all collections
            const collections = await mongoose.connection.db.collections();
            
            for (const collection of collections) {
                await collection.stats(); // Check collection stats
                await mongoose.connection.db.command({ compact: collection.collectionName });
            }

            // Update indexes
            for (const collection of collections) {
                await collection.reIndex();
            }

            this.addTask('Database Optimization', true, 'Successfully optimized database');
        } catch (error) {
            console.error('Error optimizing database:', error);
            this.addTask('Database Optimization', false, error.message);
        }
    }

    async cleanupSessions() {
        console.log('Cleaning up sessions...');
        try {
            // Remove expired sessions
            const expiredSessions = await mongoose.connection.db.collection('sessions').deleteMany({
                expires: { $lt: new Date() }
            });

            // Remove orphaned WhatsApp sessions
            const whatsappSessionPath = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
            const files = await fs.readdir(whatsappSessionPath);
            
            for (const file of files) {
                const filePath = path.join(whatsappSessionPath, file);
                const stats = await fs.stat(filePath);
                
                // Remove sessions older than 7 days
                if (Date.now() - stats.mtime.getTime() > 7 * 24 * 60 * 60 * 1000) {
                    await fs.unlink(filePath);
                }
            }

            this.addTask('Session Cleanup', true, `Removed ${expiredSessions.deletedCount} expired sessions`);
        } catch (error) {
            console.error('Error cleaning up sessions:', error);
            this.addTask('Session Cleanup', false, error.message);
        }
    }

    async cleanupUploads() {
        console.log('Cleaning up uploads...');
        try {
            const uploadsDir = process.env.UPLOAD_PATH || './uploads';
            const files = await fs.readdir(uploadsDir);
            
            // Get all valid file references from database
            const validFiles = new Set();
            const transactions = await mongoose.connection.db.collection('transactions')
                .find({ 'attachments.url': { $exists: true } })
                .project({ 'attachments.url': 1 })
                .toArray();

            transactions.forEach(t => {
                t.attachments.forEach(a => {
                    validFiles.add(path.basename(a.url));
                });
            });

            // Remove orphaned files
            let removedCount = 0;
            for (const file of files) {
                if (!validFiles.has(file)) {
                    await fs.unlink(path.join(uploadsDir, file));
                    removedCount++;
                }
            }

            this.addTask('Upload Cleanup', true, `Removed ${removedCount} orphaned files`);
        } catch (error) {
            console.error('Error cleaning up uploads:', error);
            this.addTask('Upload Cleanup', false, error.message);
        }
    }

    async cleanupTempFiles() {
        console.log('Cleaning up temporary files...');
        try {
            const tempDir = process.env.TEMP_PATH || './temp';
            const files = await fs.readdir(tempDir);
            
            for (const file of files) {
                await fs.unlink(path.join(tempDir, file));
            }

            this.addTask('Temp Cleanup', true, `Removed ${files.length} temporary files`);
        } catch (error) {
            console.error('Error cleaning up temp files:', error);
            this.addTask('Temp Cleanup', false, error.message);
        }
    }

    async validateData() {
        console.log('Validating data integrity...');
        try {
            const issues = [];

            // Check user data
            const users = await mongoose.connection.db.collection('users').find().toArray();
            for (const user of users) {
                // Check for required fields
                if (!user.username || !user.activationCode) {
                    issues.push(`Invalid user data: ${user._id}`);
                }
                
                // Check phone numbers
                if (user.phoneNumbers.length > user.maxPhoneNumbers) {
                    issues.push(`User ${user.username} exceeds phone number limit`);
                }
            }

            // Check transactions
            const transactions = await mongoose.connection.db.collection('transactions').find().toArray();
            for (const transaction of transactions) {
                // Check for required fields
                if (!transaction.user || !transaction.amount || !transaction.type) {
                    issues.push(`Invalid transaction data: ${transaction._id}`);
                }
                
                // Validate amount
                if (transaction.amount <= 0) {
                    issues.push(`Invalid transaction amount: ${transaction._id}`);
                }
            }

            // Check budgets
            const budgets = await mongoose.connection.db.collection('budgets').find().toArray();
            for (const budget of budgets) {
                // Check for required fields
                if (!budget.user || !budget.amount || !budget.startDate || !budget.endDate) {
                    issues.push(`Invalid budget data: ${budget._id}`);
                }
                
                // Validate dates
                if (budget.startDate >= budget.endDate) {
                    issues.push(`Invalid budget dates: ${budget._id}`);
                }
            }

            if (issues.length > 0) {
                this.addTask('Data Validation', false, `Found ${issues.length} issues`);
                // Log issues for admin review
                await fs.writeFile(
                    path.join(process.env.LOG_PATH || './logs', 'validation-issues.log'),
                    issues.join('\n')
                );
            } else {
                this.addTask('Data Validation', true, 'All data valid');
            }
        } catch (error) {
            console.error('Error validating data:', error);
            this.addTask('Data Validation', false, error.message);
        }
    }

    async updateIndexes() {
        console.log('Updating database indexes...');
        try {
            // User indexes
            await mongoose.connection.db.collection('users').createIndex({ username: 1 }, { unique: true });
            await mongoose.connection.db.collection('users').createIndex({ 'phoneNumbers.number': 1 }, { unique: true, sparse: true });

            // Transaction indexes
            await mongoose.connection.db.collection('transactions').createIndex({ user: 1, date: -1 });
            await mongoose.connection.db.collection('transactions').createIndex({ user: 1, type: 1 });
            await mongoose.connection.db.collection('transactions').createIndex({ user: 1, category: 1 });

            // Budget indexes
            await mongoose.connection.db.collection('budgets').createIndex({ user: 1, status: 1 });
            await mongoose.connection.db.collection('budgets').createIndex({ user: 1, startDate: 1, endDate: 1 });

            this.addTask('Index Update', true, 'Successfully updated all indexes');
        } catch (error) {
            console.error('Error updating indexes:', error);
            this.addTask('Index Update', false, error.message);
        }
    }

    async checkIntegrity() {
        console.log('Checking system integrity...');
        try {
            // Check file permissions
            await this.checkFilePermissions();

            // Check system dependencies
            await this.checkDependencies();

            // Check disk space
            await this.checkDiskSpace();

            this.addTask('System Integrity', true, 'All integrity checks passed');
        } catch (error) {
            console.error('Error checking system integrity:', error);
            this.addTask('System Integrity', false, error.message);
        }
    }

    async checkFilePermissions() {
        const criticalPaths = [
            process.env.LOG_PATH || './logs',
            process.env.UPLOAD_PATH || './uploads',
            process.env.BACKUP_PATH || './backups',
            process.env.WHATSAPP_SESSION_PATH || './whatsapp-session'
        ];

        for (const path of criticalPaths) {
            try {
                await fs.access(path, fs.constants.R_OK | fs.constants.W_OK);
            } catch (error) {
                throw new Error(`Invalid permissions for ${path}: ${error.message}`);
            }
        }
    }

    async checkDependencies() {
        const { stdout } = await execAsync('npm list --json');
        const dependencies = JSON.parse(stdout);
        
        if (dependencies.problems && dependencies.problems.length > 0) {
            throw new Error(`Dependency issues found: ${dependencies.problems.join(', ')}`);
        }
    }

    async checkDiskSpace() {
        const { stdout } = await execAsync('df -h / | tail -1');
        const [, , , , usage] = stdout.split(/\s+/);
        const usagePercent = parseInt(usage);
        
        if (usagePercent > 90) {
            throw new Error(`Critical disk usage: ${usage}`);
        }
    }

    addTask(name, success, message) {
        this.tasks.push({
            name,
            success,
            message,
            timestamp: new Date()
        });
    }

    async generateReport() {
        console.log('\n=== Maintenance Report ===\n');

        let successCount = 0;
        let failureCount = 0;

        this.tasks.forEach(task => {
            console.log(`${task.success ? '✓' : '✗'} ${task.name}: ${task.message}`);
            task.success ? successCount++ : failureCount++;
        });

        console.log('\nSummary:');
        console.log(`Total Tasks: ${this.tasks.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${failureCount}`);

        // Save report to database
        await mongoose.connection.db.collection('maintenance_logs').insertOne({
            timestamp: new Date(),
            tasks: this.tasks,
            summary: {
                total: this.tasks.length,
                successful: successCount,
                failed: failureCount
            }
        });

        // Save report to file
        const reportPath = path.join(process.env.LOG_PATH || './logs', 
            `maintenance-${new Date().toISOString()}.log`);
        
        await fs.writeFile(reportPath, 
            JSON.stringify({ tasks: this.tasks, summary: {
                total: this.tasks.length,
                successful: successCount,
                failed: failureCount
            }}, null, 2)
        );

        return failureCount === 0;
    }
}

// Command line interface
const main = async () => {
    const maintenance = new SystemMaintenance();
    
    try {
        await maintenance.performMaintenance();
    } catch (error) {
        console.error('Maintenance failed:', error);
        process.exit(1);
    }
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = SystemMaintenance;

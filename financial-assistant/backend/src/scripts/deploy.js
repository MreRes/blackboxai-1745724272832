require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class Deployer {
    constructor() {
        this.steps = [];
        this.backupCreated = false;
    }

    async deploy() {
        try {
            console.log('Starting deployment process...');

            // Pre-deployment checks
            await this.preDeploymentChecks();

            // Create backup
            await this.createBackup();

            // Stop services
            await this.stopServices();

            // Update code
            await this.updateCode();

            // Update dependencies
            await this.updateDependencies();

            // Run database migrations
            await this.runMigrations();

            // Build assets
            await this.buildAssets();

            // Start services
            await this.startServices();

            // Run tests
            await this.runTests();

            // Post-deployment checks
            await this.postDeploymentChecks();

            // Generate deployment report
            await this.generateReport();

        } catch (error) {
            console.error('Deployment failed:', error);
            await this.handleFailure(error);
            throw error;
        }
    }

    async preDeploymentChecks() {
        console.log('Running pre-deployment checks...');
        try {
            // Check Node.js version
            const { stdout: nodeVersion } = await execAsync('node --version');
            const requiredVersion = 'v14.0.0';
            if (this.compareVersions(nodeVersion.trim(), requiredVersion) < 0) {
                throw new Error(`Node.js version ${requiredVersion} or higher is required`);
            }

            // Check disk space
            const { stdout: diskSpace } = await execAsync('df -h / | tail -1');
            const [, , , available] = diskSpace.split(/\s+/);
            const availableGB = parseFloat(available);
            if (availableGB < 5) { // Require at least 5GB free space
                throw new Error(`Insufficient disk space: ${available} available`);
            }

            // Check required directories
            const requiredDirs = ['logs', 'uploads', 'backups', 'whatsapp-session'];
            for (const dir of requiredDirs) {
                await fs.access(dir).catch(() => fs.mkdir(dir, { recursive: true }));
            }

            // Check environment variables
            const requiredEnvVars = [
                'MONGODB_URI',
                'JWT_SECRET',
                'NODE_ENV'
            ];
            const missingVars = requiredEnvVars.filter(v => !process.env[v]);
            if (missingVars.length > 0) {
                throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
            }

            this.addStep('Pre-deployment Checks', true, 'All checks passed');
        } catch (error) {
            this.addStep('Pre-deployment Checks', false, error.message);
            throw error;
        }
    }

    async createBackup() {
        console.log('Creating backup...');
        try {
            const BackupScript = require('./backup');
            const backup = new BackupScript();
            const result = await backup.createBackup();

            if (result.success) {
                this.backupCreated = true;
                this.backupPath = result.path;
                this.addStep('Backup Creation', true, `Backup created at ${result.path}`);
            } else {
                throw new Error('Backup creation failed');
            }
        } catch (error) {
            this.addStep('Backup Creation', false, error.message);
            throw error;
        }
    }

    async stopServices() {
        console.log('Stopping services...');
        try {
            // Stop main application
            await execAsync('pm2 stop financial-assistant || true');

            // Stop WhatsApp bot
            await execAsync('pm2 stop whatsapp-bot || true');

            this.addStep('Stop Services', true, 'All services stopped');
        } catch (error) {
            this.addStep('Stop Services', false, error.message);
            throw error;
        }
    }

    async updateCode() {
        console.log('Updating code...');
        try {
            // Pull latest changes
            await execAsync('git fetch origin');
            await execAsync('git reset --hard origin/main');

            this.addStep('Code Update', true, 'Code updated successfully');
        } catch (error) {
            this.addStep('Code Update', false, error.message);
            throw error;
        }
    }

    async updateDependencies() {
        console.log('Updating dependencies...');
        try {
            // Install/update backend dependencies
            await execAsync('cd backend && npm install --production');

            // Install/update frontend dependencies
            await execAsync('cd frontend && npm install --production');

            this.addStep('Dependencies Update', true, 'Dependencies updated successfully');
        } catch (error) {
            this.addStep('Dependencies Update', false, error.message);
            throw error;
        }
    }

    async runMigrations() {
        console.log('Running database migrations...');
        try {
            // Run database initialization script
            const InitDB = require('./init-db');
            await InitDB();

            this.addStep('Database Migrations', true, 'Migrations completed successfully');
        } catch (error) {
            this.addStep('Database Migrations', false, error.message);
            throw error;
        }
    }

    async buildAssets() {
        console.log('Building assets...');
        try {
            // Build frontend assets
            await execAsync('cd frontend && npm run build');

            this.addStep('Asset Building', true, 'Assets built successfully');
        } catch (error) {
            this.addStep('Asset Building', false, error.message);
            throw error;
        }
    }

    async startServices() {
        console.log('Starting services...');
        try {
            // Start main application
            await execAsync('pm2 start ecosystem.config.js');

            this.addStep('Start Services', true, 'All services started');
        } catch (error) {
            this.addStep('Start Services', false, error.message);
            throw error;
        }
    }

    async runTests() {
        console.log('Running tests...');
        try {
            const TestScript = require('./test');
            const tester = new TestScript();
            await tester.runAllTests();

            this.addStep('Tests', true, 'All tests passed');
        } catch (error) {
            this.addStep('Tests', false, error.message);
            throw error;
        }
    }

    async postDeploymentChecks() {
        console.log('Running post-deployment checks...');
        try {
            // Check if services are running
            const { stdout: pmList } = await execAsync('pm2 list');
            if (!pmList.includes('financial-assistant') || !pmList.includes('whatsapp-bot')) {
                throw new Error('Some services failed to start');
            }

            // Check API health
            const response = await fetch('http://localhost:3000/health');
            if (!response.ok) {
                throw new Error('API health check failed');
            }

            // Check database connection
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                throw new Error('Database connection check failed');
            }

            this.addStep('Post-deployment Checks', true, 'All checks passed');
        } catch (error) {
            this.addStep('Post-deployment Checks', false, error.message);
            throw error;
        }
    }

    async handleFailure(error) {
        console.log('Handling deployment failure...');
        try {
            // Restore from backup if it was created
            if (this.backupCreated && this.backupPath) {
                console.log('Restoring from backup...');
                const BackupScript = require('./backup');
                const backup = new BackupScript();
                await backup.restoreBackup(this.backupPath);
            }

            // Restart services
            await execAsync('pm2 restart all');

            // Log failure
            await fs.appendFile(
                path.join('logs', 'deployment-failures.log'),
                `${new Date().toISOString()}: ${error.message}\n`
            );

            // Send notification (if configured)
            if (process.env.NOTIFICATION_EMAIL) {
                // TODO: Implement email notification
            }
        } catch (restoreError) {
            console.error('Error during failure handling:', restoreError);
        }
    }

    async generateReport() {
        console.log('\n=== Deployment Report ===\n');

        let successCount = 0;
        let failureCount = 0;

        this.steps.forEach(step => {
            console.log(`${step.success ? '✓' : '✗'} ${step.name}: ${step.message}`);
            step.success ? successCount++ : failureCount++;
        });

        console.log('\nSummary:');
        console.log(`Total Steps: ${this.steps.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Failed: ${failureCount}`);

        // Save deployment log
        const report = {
            timestamp: new Date(),
            steps: this.steps,
            summary: {
                total: this.steps.length,
                successful: successCount,
                failed: failureCount
            }
        };

        await fs.writeFile(
            path.join('logs', `deployment-${new Date().toISOString()}.log`),
            JSON.stringify(report, null, 2)
        );

        return failureCount === 0;
    }

    addStep(name, success, message) {
        this.steps.push({
            name,
            success,
            message,
            timestamp: new Date()
        });
    }

    compareVersions(v1, v2) {
        const normalize = v => v.replace('v', '').split('.').map(Number);
        const [a1, a2, a3] = normalize(v1);
        const [b1, b2, b3] = normalize(v2);
        
        if (a1 !== b1) return a1 - b1;
        if (a2 !== b2) return a2 - b2;
        return a3 - b3;
    }
}

// Command line interface
const main = async () => {
    const deployer = new Deployer();
    
    try {
        await deployer.deploy();
        console.log('Deployment completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Deployment failed:', error);
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

module.exports = Deployer;

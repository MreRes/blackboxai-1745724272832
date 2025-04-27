require('dotenv').config();
const mongoose = require('mongoose');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class SystemMonitor {
    constructor() {
        this.metrics = {
            system: {},
            database: {},
            whatsapp: {},
            api: {}
        };
        this.alerts = [];
        this.thresholds = {
            cpuUsage: 80, // percentage
            memoryUsage: 85, // percentage
            diskUsage: 90, // percentage
            responseTime: 1000, // milliseconds
            errorRate: 5 // percentage
        };
    }

    async checkSystem() {
        try {
            // CPU Usage
            const cpuUsage = await this.getCPUUsage();
            this.metrics.system.cpu = cpuUsage;

            // Memory Usage
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
            this.metrics.system.memory = {
                total: totalMem,
                free: freeMem,
                used: totalMem - freeMem,
                percentage: memoryUsage
            };

            // Disk Usage
            const diskUsage = await this.getDiskUsage();
            this.metrics.system.disk = diskUsage;

            // System Load
            const loadAvg = os.loadavg();
            this.metrics.system.load = {
                '1m': loadAvg[0],
                '5m': loadAvg[1],
                '15m': loadAvg[2]
            };

            // System Uptime
            this.metrics.system.uptime = os.uptime();

            // Check thresholds
            if (cpuUsage > this.thresholds.cpuUsage) {
                this.addAlert('system', 'High CPU usage', `CPU usage at ${cpuUsage.toFixed(2)}%`);
            }
            if (memoryUsage > this.thresholds.memoryUsage) {
                this.addAlert('system', 'High memory usage', `Memory usage at ${memoryUsage.toFixed(2)}%`);
            }
            if (diskUsage.percentage > this.thresholds.diskUsage) {
                this.addAlert('system', 'High disk usage', `Disk usage at ${diskUsage.percentage.toFixed(2)}%`);
            }

        } catch (error) {
            console.error('Error checking system metrics:', error);
            this.addAlert('system', 'Monitoring error', error.message);
        }
    }

    async checkDatabase() {
        try {
            // Connect to MongoDB if not connected
            if (mongoose.connection.readyState !== 1) {
                await mongoose.connect(process.env.MONGODB_URI, {
                    useNewUrlParser: true,
                    useUnifiedTopology: true
                });
            }

            // Database status
            this.metrics.database.status = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

            // Database stats
            const dbStats = await mongoose.connection.db.stats();
            this.metrics.database.stats = {
                collections: dbStats.collections,
                documents: dbStats.objects,
                dataSize: dbStats.dataSize,
                storageSize: dbStats.storageSize,
                indexes: dbStats.indexes,
                indexSize: dbStats.indexSize
            };

            // Check slow queries
            const slowQueries = await this.getSlowQueries();
            this.metrics.database.slowQueries = slowQueries;

            if (slowQueries.length > 0) {
                this.addAlert('database', 'Slow queries detected', `${slowQueries.length} slow queries found`);
            }

        } catch (error) {
            console.error('Error checking database metrics:', error);
            this.addAlert('database', 'Database monitoring error', error.message);
        }
    }

    async checkWhatsApp() {
        try {
            // Check WhatsApp process
            const { stdout } = await execAsync('ps aux | grep whatsapp-web | grep -v grep');
            const isRunning = stdout.length > 0;

            this.metrics.whatsapp = {
                status: isRunning ? 'running' : 'stopped',
                lastCheck: new Date(),
                memory: 0,
                cpu: 0
            };

            if (isRunning) {
                // Get process details
                const pid = stdout.split(/\s+/)[1];
                const processStats = await this.getProcessStats(pid);
                this.metrics.whatsapp.memory = processStats.memory;
                this.metrics.whatsapp.cpu = processStats.cpu;
            } else {
                this.addAlert('whatsapp', 'WhatsApp process not running', 'WhatsApp service is down');
            }

        } catch (error) {
            console.error('Error checking WhatsApp metrics:', error);
            this.addAlert('whatsapp', 'WhatsApp monitoring error', error.message);
        }
    }

    async checkAPI() {
        try {
            // API endpoints health check
            const endpoints = [
                '/health',
                '/api/auth/verify',
                '/api/transactions',
                '/api/budgets'
            ];

            const results = await Promise.all(endpoints.map(async endpoint => {
                const startTime = Date.now();
                try {
                    const response = await fetch(`http://localhost:${process.env.PORT}${endpoint}`, {
                        headers: { 'Authorization': 'Bearer ' + process.env.MONITOR_TOKEN }
                    });
                    const responseTime = Date.now() - startTime;
                    
                    return {
                        endpoint,
                        status: response.status,
                        responseTime,
                        healthy: response.status === 200
                    };
                } catch (error) {
                    return {
                        endpoint,
                        status: 500,
                        responseTime: Date.now() - startTime,
                        healthy: false,
                        error: error.message
                    };
                }
            }));

            this.metrics.api = {
                endpoints: results,
                totalEndpoints: endpoints.length,
                healthyEndpoints: results.filter(r => r.healthy).length,
                averageResponseTime: results.reduce((acc, r) => acc + r.responseTime, 0) / results.length
            };

            // Check response time threshold
            if (this.metrics.api.averageResponseTime > this.thresholds.responseTime) {
                this.addAlert('api', 'High response time', 
                    `Average response time: ${this.metrics.api.averageResponseTime.toFixed(2)}ms`);
            }

            // Check error rate
            const errorRate = (1 - this.metrics.api.healthyEndpoints / this.metrics.api.totalEndpoints) * 100;
            if (errorRate > this.thresholds.errorRate) {
                this.addAlert('api', 'High error rate', `API error rate: ${errorRate.toFixed(2)}%`);
            }

        } catch (error) {
            console.error('Error checking API metrics:', error);
            this.addAlert('api', 'API monitoring error', error.message);
        }
    }

    async getCPUUsage() {
        const startMeasure = process.cpuUsage();
        await new Promise(resolve => setTimeout(resolve, 100));
        const endMeasure = process.cpuUsage(startMeasure);
        const userUsage = endMeasure.user / 1000000; // Convert to seconds
        const systemUsage = endMeasure.system / 1000000;
        return (userUsage + systemUsage) * 100;
    }

    async getDiskUsage() {
        const { stdout } = await execAsync('df -h / | tail -1');
        const [filesystem, size, used, available, percentage] = stdout.split(/\s+/);
        return {
            filesystem,
            size,
            used,
            available,
            percentage: parseInt(percentage)
        };
    }

    async getSlowQueries() {
        // This is a simplified example. In production, you would need to configure MongoDB profiling
        const slowQueries = await mongoose.connection.db.collection('system.profile')
            .find({ millis: { $gt: 100 } })
            .sort({ ts: -1 })
            .limit(10)
            .toArray();

        return slowQueries.map(q => ({
            operation: q.op,
            namespace: q.ns,
            duration: q.millis,
            timestamp: q.ts
        }));
    }

    async getProcessStats(pid) {
        const { stdout } = await execAsync(`ps -p ${pid} -o %cpu,%mem`);
        const [cpu, memory] = stdout.split('\n')[1].trim().split(/\s+/);
        return {
            cpu: parseFloat(cpu),
            memory: parseFloat(memory)
        };
    }

    addAlert(category, title, message) {
        this.alerts.push({
            category,
            title,
            message,
            timestamp: new Date()
        });
    }

    async generateReport() {
        await Promise.all([
            this.checkSystem(),
            this.checkDatabase(),
            this.checkWhatsApp(),
            this.checkAPI()
        ]);

        return {
            timestamp: new Date(),
            metrics: this.metrics,
            alerts: this.alerts,
            status: this.alerts.length === 0 ? 'healthy' : 'warning'
        };
    }

    async start(interval = 60000) {
        console.log('Starting system monitoring...');
        
        // Initial check
        const report = await this.generateReport();
        console.log('Initial system status:', report.status);
        
        if (report.alerts.length > 0) {
            console.log('Alerts:', report.alerts);
        }

        // Schedule regular checks
        setInterval(async () => {
            const report = await this.generateReport();
            
            // Log alerts
            if (report.alerts.length > 0) {
                console.log(`[${new Date().toISOString()}] Alerts:`, report.alerts);
            }

            // Save metrics to database
            try {
                await mongoose.connection.db.collection('system_metrics').insertOne({
                    timestamp: new Date(),
                    metrics: report.metrics,
                    alerts: report.alerts,
                    status: report.status
                });
            } catch (error) {
                console.error('Error saving metrics:', error);
            }
        }, interval);
    }
}

// Command line interface
const main = async () => {
    const monitor = new SystemMonitor();
    
    if (process.argv[2] === '--once') {
        // Single check
        const report = await monitor.generateReport();
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
    } else {
        // Continuous monitoring
        await monitor.start();
    }
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = SystemMonitor;

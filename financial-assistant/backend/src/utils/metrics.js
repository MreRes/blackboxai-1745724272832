const prometheus = require('prom-client');
const os = require('os');
const logger = require('./logger');

class MetricsCollector {
    constructor() {
        // Initialize Prometheus registry
        this.registry = new prometheus.Registry();

        // Add default metrics
        prometheus.collectDefaultMetrics({ register: this.registry });

        // Initialize custom metrics
        this.initializeMetrics();
    }

    // Initialize custom metrics
    initializeMetrics() {
        // HTTP metrics
        this.httpRequestDuration = new prometheus.Histogram({
            name: 'http_request_duration_seconds',
            help: 'Duration of HTTP requests in seconds',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
        });

        this.httpRequestTotal = new prometheus.Counter({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'route', 'status_code']
        });

        // Database metrics
        this.dbOperationDuration = new prometheus.Histogram({
            name: 'db_operation_duration_seconds',
            help: 'Duration of database operations in seconds',
            labelNames: ['operation', 'collection'],
            buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
        });

        this.dbOperationTotal = new prometheus.Counter({
            name: 'db_operations_total',
            help: 'Total number of database operations',
            labelNames: ['operation', 'collection', 'status']
        });

        // WhatsApp metrics
        this.whatsappMessageTotal = new prometheus.Counter({
            name: 'whatsapp_messages_total',
            help: 'Total number of WhatsApp messages',
            labelNames: ['type', 'status']
        });

        this.whatsappProcessingTime = new prometheus.Histogram({
            name: 'whatsapp_processing_time_seconds',
            help: 'Time taken to process WhatsApp messages',
            labelNames: ['type'],
            buckets: [0.1, 0.5, 1, 2, 5]
        });

        // Business metrics
        this.activeUsers = new prometheus.Gauge({
            name: 'active_users',
            help: 'Number of active users'
        });

        this.transactionTotal = new prometheus.Counter({
            name: 'transactions_total',
            help: 'Total number of financial transactions',
            labelNames: ['type']
        });

        this.transactionAmount = new prometheus.Histogram({
            name: 'transaction_amount',
            help: 'Distribution of transaction amounts',
            labelNames: ['type'],
            buckets: [10000, 50000, 100000, 500000, 1000000, 5000000]
        });

        // System metrics
        this.systemMemoryUsage = new prometheus.Gauge({
            name: 'system_memory_usage_bytes',
            help: 'System memory usage in bytes'
        });

        this.systemCpuUsage = new prometheus.Gauge({
            name: 'system_cpu_usage_percent',
            help: 'System CPU usage percentage'
        });

        // Register all metrics
        this.registry.registerMetric(this.httpRequestDuration);
        this.registry.registerMetric(this.httpRequestTotal);
        this.registry.registerMetric(this.dbOperationDuration);
        this.registry.registerMetric(this.dbOperationTotal);
        this.registry.registerMetric(this.whatsappMessageTotal);
        this.registry.registerMetric(this.whatsappProcessingTime);
        this.registry.registerMetric(this.activeUsers);
        this.registry.registerMetric(this.transactionTotal);
        this.registry.registerMetric(this.transactionAmount);
        this.registry.registerMetric(this.systemMemoryUsage);
        this.registry.registerMetric(this.systemCpuUsage);
    }

    // HTTP request middleware
    httpMetricsMiddleware() {
        return (req, res, next) => {
            const start = process.hrtime();

            // Record response
            res.on('finish', () => {
                const duration = process.hrtime(start);
                const durationSeconds = duration[0] + duration[1] / 1e9;

                // Record metrics
                this.httpRequestDuration.observe(
                    { method: req.method, route: req.route?.path || req.path, status_code: res.statusCode },
                    durationSeconds
                );

                this.httpRequestTotal.inc({
                    method: req.method,
                    route: req.route?.path || req.path,
                    status_code: res.statusCode
                });
            });

            next();
        };
    }

    // Database operation monitoring
    async monitorDbOperation(operation, collection, callback) {
        const start = process.hrtime();
        try {
            const result = await callback();
            const duration = process.hrtime(start);
            const durationSeconds = duration[0] + duration[1] / 1e9;

            this.dbOperationDuration.observe(
                { operation, collection },
                durationSeconds
            );

            this.dbOperationTotal.inc({
                operation,
                collection,
                status: 'success'
            });

            return result;
        } catch (error) {
            this.dbOperationTotal.inc({
                operation,
                collection,
                status: 'error'
            });
            throw error;
        }
    }

    // WhatsApp message monitoring
    recordWhatsAppMessage(type, status) {
        this.whatsappMessageTotal.inc({ type, status });
    }

    recordWhatsAppProcessing(type, duration) {
        this.whatsappProcessingTime.observe({ type }, duration);
    }

    // Business metrics
    updateActiveUsers(count) {
        this.activeUsers.set(count);
    }

    recordTransaction(type, amount) {
        this.transactionTotal.inc({ type });
        this.transactionAmount.observe({ type }, amount);
    }

    // System metrics collection
    async collectSystemMetrics() {
        try {
            // Memory usage
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            this.systemMemoryUsage.set(usedMem);

            // CPU usage
            const cpus = os.cpus();
            const cpuUsage = cpus.reduce((acc, cpu) => {
                const total = Object.values(cpu.times).reduce((a, b) => a + b);
                const idle = cpu.times.idle;
                return acc + ((total - idle) / total);
            }, 0) / cpus.length * 100;

            this.systemCpuUsage.set(cpuUsage);
        } catch (error) {
            logger.error(error, { type: 'system_metrics_collection_error' });
        }
    }

    // Get all metrics
    async getMetrics() {
        try {
            return await this.registry.metrics();
        } catch (error) {
            logger.error(error, { type: 'metrics_collection_error' });
            throw error;
        }
    }

    // Reset all metrics
    async resetMetrics() {
        try {
            await this.registry.resetMetrics();
            logger.info('Metrics reset successfully');
        } catch (error) {
            logger.error(error, { type: 'metrics_reset_error' });
            throw error;
        }
    }

    // Get specific metric
    async getMetric(name) {
        try {
            const metrics = await this.registry.getMetricsAsJSON();
            return metrics.find(m => m.name === name);
        } catch (error) {
            logger.error(error, { type: 'metric_retrieval_error', metric: name });
            throw error;
        }
    }

    // Express middleware for metrics endpoint
    metricsEndpoint() {
        return async (req, res) => {
            try {
                // Update system metrics before sending
                await this.collectSystemMetrics();
                
                // Get metrics
                const metrics = await this.getMetrics();
                
                // Send response
                res.set('Content-Type', this.registry.contentType);
                res.send(metrics);
            } catch (error) {
                logger.error(error, { type: 'metrics_endpoint_error' });
                res.status(500).json({
                    success: false,
                    message: 'Error collecting metrics'
                });
            }
        };
    }

    // Start periodic system metrics collection
    startSystemMetricsCollection(interval = 60000) { // Default: 1 minute
        setInterval(() => {
            this.collectSystemMetrics().catch(error => {
                logger.error(error, { type: 'periodic_metrics_collection_error' });
            });
        }, interval);
    }

    // Generate metrics report
    async generateReport() {
        try {
            const metrics = await this.registry.getMetricsAsJSON();
            const report = {
                timestamp: new Date(),
                http: {
                    totalRequests: metrics.find(m => m.name === 'http_requests_total')?.values || [],
                    avgDuration: metrics.find(m => m.name === 'http_request_duration_seconds')?.values || []
                },
                database: {
                    operations: metrics.find(m => m.name === 'db_operations_total')?.values || [],
                    performance: metrics.find(m => m.name === 'db_operation_duration_seconds')?.values || []
                },
                whatsapp: {
                    messages: metrics.find(m => m.name === 'whatsapp_messages_total')?.values || [],
                    processing: metrics.find(m => m.name === 'whatsapp_processing_time_seconds')?.values || []
                },
                business: {
                    activeUsers: metrics.find(m => m.name === 'active_users')?.value || 0,
                    transactions: metrics.find(m => m.name === 'transactions_total')?.values || []
                },
                system: {
                    memory: metrics.find(m => m.name === 'system_memory_usage_bytes')?.value || 0,
                    cpu: metrics.find(m => m.name === 'system_cpu_usage_percent')?.value || 0
                }
            };

            return report;
        } catch (error) {
            logger.error(error, { type: 'metrics_report_generation_error' });
            throw error;
        }
    }
}

module.exports = new MetricsCollector();

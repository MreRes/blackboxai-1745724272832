const mongoose = require('mongoose');
const logger = require('./logger');
const cache = require('./cache');
const metrics = require('./metrics');

class DatabaseManager {
    constructor() {
        this.isConnected = false;
        this.retryAttempts = 5;
        this.retryDelay = 5000; // 5 seconds
        this.collections = new Set();
        
        // Initialize indexes
        this.indexes = {
            users: [
                { username: 1 },
                { 'phoneNumbers.number': 1 },
                { expiryDate: 1 }
            ],
            transactions: [
                { user: 1, date: -1 },
                { user: 1, type: 1 },
                { user: 1, category: 1 },
                { date: 1 }
            ],
            budgets: [
                { user: 1, status: 1 },
                { user: 1, startDate: 1, endDate: 1 },
                { 'categories.name': 1 }
            ],
            audit_logs: [
                { timestamp: -1 },
                { 'user.id': 1 },
                { eventType: 1 }
            ]
        };
    }

    // Initialize database connection
    async initialize() {
        try {
            await this.connect();
            await this.setupCollections();
            await this.createIndexes();
            await this.validateCollections();
            
            logger.info('Database initialization completed');
        } catch (error) {
            logger.error(error, { type: 'database_initialization_error' });
            throw error;
        }
    }

    // Connect to database
    async connect() {
        let attempts = 0;

        while (attempts < this.retryAttempts) {
            try {
                await mongoose.connect(process.env.MONGODB_URI, {
                    useNewUrlParser: true,
                    useUnifiedTopology: true,
                    serverSelectionTimeoutMS: 5000,
                    heartbeatFrequencyMS: 10000
                });

                this.isConnected = true;
                logger.info('Database connected successfully');
                
                // Monitor connection
                this.monitorConnection();
                
                return;
            } catch (error) {
                attempts++;
                logger.error(error, {
                    type: 'database_connection_error',
                    attempt: attempts
                });

                if (attempts === this.retryAttempts) {
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }
    }

    // Monitor database connection
    monitorConnection() {
        mongoose.connection.on('disconnected', () => {
            this.isConnected = false;
            logger.error('Database connection lost');
            metrics.databaseDisconnections.inc();
        });

        mongoose.connection.on('reconnected', () => {
            this.isConnected = true;
            logger.info('Database reconnected');
            metrics.databaseReconnections.inc();
        });

        mongoose.connection.on('error', (error) => {
            logger.error(error, { type: 'database_connection_error' });
            metrics.databaseErrors.inc();
        });
    }

    // Setup collections
    async setupCollections() {
        try {
            const collections = await mongoose.connection.db.listCollections().toArray();
            this.collections = new Set(collections.map(c => c.name));

            // Create missing collections
            const requiredCollections = [
                'users',
                'transactions',
                'budgets',
                'audit_logs',
                'system_metrics'
            ];

            for (const collection of requiredCollections) {
                if (!this.collections.has(collection)) {
                    await mongoose.connection.db.createCollection(collection);
                    logger.info(`Created collection: ${collection}`);
                }
            }
        } catch (error) {
            logger.error(error, { type: 'collection_setup_error' });
            throw error;
        }
    }

    // Create indexes
    async createIndexes() {
        try {
            for (const [collection, indexes] of Object.entries(this.indexes)) {
                for (const index of indexes) {
                    await mongoose.connection.db.collection(collection).createIndex(
                        index,
                        { background: true }
                    );
                }
                logger.info(`Created indexes for collection: ${collection}`);
            }
        } catch (error) {
            logger.error(error, { type: 'index_creation_error' });
            throw error;
        }
    }

    // Validate collections
    async validateCollections() {
        try {
            for (const collection of this.collections) {
                const result = await mongoose.connection.db.command({
                    validate: collection
                });

                if (!result.valid) {
                    logger.error('Collection validation failed', {
                        collection,
                        errors: result.errors
                    });
                }
            }
        } catch (error) {
            logger.error(error, { type: 'collection_validation_error' });
            throw error;
        }
    }

    // Execute query with monitoring
    async executeQuery(operation, collection, query) {
        const startTime = process.hrtime();

        try {
            const result = await query();

            // Record metrics
            const duration = process.hrtime(startTime);
            const durationMs = duration[0] * 1000 + duration[1] / 1000000;
            metrics.databaseOperations.inc({ operation, collection, status: 'success' });
            metrics.databaseOperationDuration.observe({ operation, collection }, durationMs);

            return result;
        } catch (error) {
            // Record error metrics
            metrics.databaseOperations.inc({ operation, collection, status: 'error' });
            metrics.databaseErrors.inc({ operation, collection });

            logger.error(error, {
                type: 'database_query_error',
                operation,
                collection
            });

            throw error;
        }
    }

    // Get collection stats
    async getCollectionStats(collection) {
        try {
            const stats = await mongoose.connection.db.command({
                collStats: collection
            });

            return {
                name: collection,
                count: stats.count,
                size: stats.size,
                avgObjSize: stats.avgObjSize,
                storageSize: stats.storageSize,
                indexes: stats.nindexes,
                indexSize: stats.totalIndexSize
            };
        } catch (error) {
            logger.error(error, {
                type: 'collection_stats_error',
                collection
            });
            throw error;
        }
    }

    // Get database stats
    async getDatabaseStats() {
        try {
            const stats = await mongoose.connection.db.command({ dbStats: 1 });
            const collectionStats = {};

            for (const collection of this.collections) {
                collectionStats[collection] = await this.getCollectionStats(collection);
            }

            return {
                collections: collectionStats,
                dataSize: stats.dataSize,
                storageSize: stats.storageSize,
                indexes: stats.indexes,
                indexSize: stats.indexSize,
                objects: stats.objects
            };
        } catch (error) {
            logger.error(error, { type: 'database_stats_error' });
            throw error;
        }
    }

    // Clear collection
    async clearCollection(collection) {
        try {
            await mongoose.connection.db.collection(collection).deleteMany({});
            logger.info(`Cleared collection: ${collection}`);
        } catch (error) {
            logger.error(error, {
                type: 'collection_clear_error',
                collection
            });
            throw error;
        }
    }

    // Drop collection
    async dropCollection(collection) {
        try {
            await mongoose.connection.db.collection(collection).drop();
            this.collections.delete(collection);
            logger.info(`Dropped collection: ${collection}`);
        } catch (error) {
            logger.error(error, {
                type: 'collection_drop_error',
                collection
            });
            throw error;
        }
    }

    // Repair database
    async repairDatabase() {
        try {
            await mongoose.connection.db.command({ repairDatabase: 1 });
            logger.info('Database repair completed');
        } catch (error) {
            logger.error(error, { type: 'database_repair_error' });
            throw error;
        }
    }

    // Close connection
    async close() {
        try {
            await mongoose.connection.close();
            this.isConnected = false;
            logger.info('Database connection closed');
        } catch (error) {
            logger.error(error, { type: 'database_close_error' });
            throw error;
        }
    }

    // Get connection status
    getStatus() {
        return {
            isConnected: this.isConnected,
            collections: Array.from(this.collections),
            connectionState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name
        };
    }
}

module.exports = new DatabaseManager();

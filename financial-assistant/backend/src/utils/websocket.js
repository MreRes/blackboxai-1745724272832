const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const security = require('./security');
const metrics = require('./metrics');

class WebSocketServer {
    constructor() {
        this.clients = new Map(); // Map of client connections
        this.subscriptions = new Map(); // Map of topic subscriptions
        this.heartbeatInterval = 30000; // 30 seconds
        this.pingTimeout = 5000; // 5 seconds

        // Initialize event handlers
        this.eventHandlers = {
            'transaction.created': this.handleTransactionCreated.bind(this),
            'transaction.updated': this.handleTransactionUpdated.bind(this),
            'budget.alert': this.handleBudgetAlert.bind(this),
            'user.notification': this.handleUserNotification.bind(this)
        };
    }

    // Initialize WebSocket server
    initialize(server) {
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        logger.info('WebSocket server initialized');
    }

    // Handle new connection
    async handleConnection(ws, req) {
        try {
            // Extract token from query string
            const token = new URL(req.url, 'http://localhost').searchParams.get('token');
            if (!token) {
                throw new Error('No authentication token provided');
            }

            // Verify token
            const decoded = security.verifyToken(token);
            if (!decoded) {
                throw new Error('Invalid authentication token');
            }

            // Store client info
            const clientId = decoded.userId;
            ws.clientId = clientId;
            ws.isAlive = true;

            // Add to clients map
            this.clients.set(clientId, ws);

            // Setup ping/pong
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Handle messages
            ws.on('message', (message) => {
                this.handleMessage(ws, message);
            });

            // Handle close
            ws.on('close', () => {
                this.handleClose(ws);
            });

            // Handle error
            ws.on('error', (error) => {
                this.handleError(ws, error);
            });

            // Send welcome message
            this.sendToClient(ws, {
                type: 'connection',
                status: 'connected',
                clientId
            });

            // Update metrics
            metrics.websocketConnections.inc();

            logger.info('New WebSocket connection', { clientId });

        } catch (error) {
            logger.error(error, { type: 'websocket_connection_error' });
            ws.close();
        }
    }

    // Handle incoming messages
    async handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);

            // Validate message structure
            if (!data.type || !data.payload) {
                throw new Error('Invalid message format');
            }

            switch (data.type) {
                case 'subscribe':
                    await this.handleSubscribe(ws, data.payload);
                    break;
                case 'unsubscribe':
                    await this.handleUnsubscribe(ws, data.payload);
                    break;
                case 'ping':
                    this.handlePing(ws);
                    break;
                default:
                    if (this.eventHandlers[data.type]) {
                        await this.eventHandlers[data.type](ws, data.payload);
                    } else {
                        throw new Error(`Unknown message type: ${data.type}`);
                    }
            }

            // Update metrics
            metrics.websocketMessages.inc({ type: data.type });

        } catch (error) {
            logger.error(error, { type: 'websocket_message_error' });
            this.sendError(ws, error.message);
        }
    }

    // Handle subscription requests
    async handleSubscribe(ws, { topics }) {
        if (!Array.isArray(topics)) {
            throw new Error('Topics must be an array');
        }

        for (const topic of topics) {
            if (!this.subscriptions.has(topic)) {
                this.subscriptions.set(topic, new Set());
            }
            this.subscriptions.get(topic).add(ws.clientId);
        }

        this.sendToClient(ws, {
            type: 'subscribe',
            status: 'success',
            topics
        });
    }

    // Handle unsubscribe requests
    async handleUnsubscribe(ws, { topics }) {
        if (!Array.isArray(topics)) {
            throw new Error('Topics must be an array');
        }

        for (const topic of topics) {
            if (this.subscriptions.has(topic)) {
                this.subscriptions.get(topic).delete(ws.clientId);
            }
        }

        this.sendToClient(ws, {
            type: 'unsubscribe',
            status: 'success',
            topics
        });
    }

    // Handle ping messages
    handlePing(ws) {
        ws.isAlive = true;
        this.sendToClient(ws, { type: 'pong' });
    }

    // Handle connection close
    handleClose(ws) {
        // Remove from clients map
        this.clients.delete(ws.clientId);

        // Remove from all subscriptions
        for (const subscribers of this.subscriptions.values()) {
            subscribers.delete(ws.clientId);
        }

        // Update metrics
        metrics.websocketConnections.dec();

        logger.info('WebSocket connection closed', { clientId: ws.clientId });
    }

    // Handle errors
    handleError(ws, error) {
        logger.error(error, { type: 'websocket_error', clientId: ws.clientId });
        this.sendError(ws, 'Internal server error');
    }

    // Send message to specific client
    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    // Send error message to client
    sendError(ws, error) {
        this.sendToClient(ws, {
            type: 'error',
            message: error
        });
    }

    // Broadcast message to all subscribed clients
    broadcast(topic, message) {
        const subscribers = this.subscriptions.get(topic);
        if (!subscribers) return;

        for (const clientId of subscribers) {
            const client = this.clients.get(clientId);
            if (client && client.readyState === WebSocket.OPEN) {
                this.sendToClient(client, {
                    type: topic,
                    payload: message
                });
            }
        }
    }

    // Start heartbeat
    startHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (!ws.isAlive) {
                    ws.terminate();
                    return;
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, this.heartbeatInterval);
    }

    // Event Handlers

    // Handle new transaction
    async handleTransactionCreated(ws, transaction) {
        // Broadcast to relevant subscribers
        this.broadcast('transaction.created', {
            userId: transaction.user,
            transaction
        });

        // Send budget alerts if needed
        await this.checkBudgetAlerts(transaction);
    }

    // Handle transaction update
    async handleTransactionUpdated(ws, transaction) {
        this.broadcast('transaction.updated', {
            userId: transaction.user,
            transaction
        });
    }

    // Handle budget alert
    async handleBudgetAlert(ws, alert) {
        this.broadcast('budget.alert', {
            userId: alert.userId,
            alert
        });
    }

    // Handle user notification
    async handleUserNotification(ws, notification) {
        const client = this.clients.get(notification.userId);
        if (client) {
            this.sendToClient(client, {
                type: 'notification',
                payload: notification
            });
        }
    }

    // Check budget alerts after new transaction
    async checkBudgetAlerts(transaction) {
        try {
            const Budget = require('../models/budget');
            
            // Find active budgets for the category
            const budgets = await Budget.find({
                user: transaction.user,
                'categories.name': transaction.category,
                status: 'active',
                startDate: { $lte: transaction.date },
                endDate: { $gte: transaction.date }
            });

            for (const budget of budgets) {
                const category = budget.categories.find(c => c.name === transaction.category);
                if (!category) continue;

                const percentage = (category.spent / category.amount) * 100;
                if (percentage >= budget.notifications.threshold) {
                    this.broadcast('budget.alert', {
                        userId: budget.user,
                        budget: budget._id,
                        category: category.name,
                        percentage,
                        remaining: category.amount - category.spent
                    });
                }
            }
        } catch (error) {
            logger.error(error, { type: 'budget_alert_check_error' });
        }
    }

    // Get connection stats
    getStats() {
        return {
            totalConnections: this.clients.size,
            subscriptions: Array.from(this.subscriptions.entries()).map(([topic, subscribers]) => ({
                topic,
                subscribers: subscribers.size
            }))
        };
    }
}

module.exports = new WebSocketServer();

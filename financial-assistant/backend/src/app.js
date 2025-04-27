require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Import routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transaction');
const budgetRoutes = require('./routes/budget');
const adminRoutes = require('./routes/admin');

// Import handlers
const whatsappBot = require('./config/whatsapp');
const connectDB = require('./config/database');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// Connect to MongoDB
connectDB();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/admin', adminRoutes);

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        services: {
            database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            whatsapp: whatsappBot.client.pupPage ? 'connected' : 'disconnected'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        status: 'error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
    });
});

// Initialize WhatsApp bot
whatsappBot.initialize();

// Store QR code for admin dashboard
let lastQR = null;
whatsappBot.on('qr', (qr) => {
    lastQR = qr;
    qrcode.generate(qr, { small: true });
});

// QR code endpoint for admin dashboard
app.get('/api/admin/whatsapp/qr', async (req, res) => {
    if (lastQR) {
        res.json({ qr: lastQR });
    } else {
        res.status(404).json({ message: 'QR code not available' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Attempt graceful shutdown
    shutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    // Attempt graceful shutdown
    shutdown();
});

// Graceful shutdown function
const shutdown = () => {
    console.log('Initiating graceful shutdown...');
    
    // Close WhatsApp client
    if (whatsappBot.client) {
        whatsappBot.client.destroy();
    }
    
    // Close MongoDB connection
    mongoose.connection.close(() => {
        console.log('MongoDB connection closed.');
        
        // Exit process
        process.exit(1);
    });
    
    // Force exit if graceful shutdown fails
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

// Handle termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

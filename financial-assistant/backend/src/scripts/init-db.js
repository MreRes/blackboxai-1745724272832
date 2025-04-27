require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/user');

const initializeDatabase = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Check if admin user exists
        const adminExists = await User.findOne({ isAdmin: true });
        if (!adminExists) {
            // Create default admin user
            const password = process.env.DEFAULT_ADMIN_PASSWORD || 'changeme123';
            const hashedPassword = await bcrypt.hash(password, 10);

            const admin = new User({
                username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
                password: hashedPassword,
                isAdmin: true,
                maxPhoneNumbers: 0,
                expiryDate: new Date('2099-12-31'), // Never expires
                activationCode: await bcrypt.hash('not-applicable', 10)
            });

            await admin.save();
            console.log('Default admin user created');
            console.log('Username:', admin.username);
            console.log('Password:', password);
            console.log('\nIMPORTANT: Please change the admin password after first login!');
        } else {
            console.log('Admin user already exists');
        }

        // Create indexes
        console.log('Creating indexes...');

        // User indexes
        await User.collection.createIndex({ username: 1 }, { unique: true });
        await User.collection.createIndex({ 'phoneNumbers.number': 1 }, { unique: true, sparse: true });

        // Transaction indexes (if collection exists)
        if (mongoose.connection.collections['transactions']) {
            await mongoose.connection.collections['transactions'].createIndex({ user: 1, date: -1 });
            await mongoose.connection.collections['transactions'].createIndex({ user: 1, type: 1 });
            await mongoose.connection.collections['transactions'].createIndex({ user: 1, category: 1 });
            await mongoose.connection.collections['transactions'].createIndex({ date: 1 });
        }

        // Budget indexes (if collection exists)
        if (mongoose.connection.collections['budgets']) {
            await mongoose.connection.collections['budgets'].createIndex({ user: 1, status: 1 });
            await mongoose.connection.collections['budgets'].createIndex({ user: 1, startDate: 1, endDate: 1 });
            await mongoose.connection.collections['budgets'].createIndex({ 'categories.name': 1 });
        }

        console.log('Database initialization completed successfully');

        // Create default categories
        const defaultCategories = [
            // Income categories
            'Gaji',
            'Bonus',
            'Investasi',
            'Penjualan',
            'Hadiah',
            'Lainnya',

            // Expense categories
            'Makanan & Minuman',
            'Transportasi',
            'Belanja',
            'Tagihan',
            'Kesehatan',
            'Pendidikan',
            'Hiburan',
            'Donasi',
            'Tabungan',
            'Investasi',
            'Lainnya'
        ];

        // Store categories in database or configuration
        if (mongoose.connection.collections['categories']) {
            const existingCategories = await mongoose.connection.collections['categories'].countDocuments();
            if (existingCategories === 0) {
                await mongoose.connection.collections['categories'].insertMany(
                    defaultCategories.map(name => ({ name, isDefault: true }))
                );
                console.log('Default categories created');
            }
        }

    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Run initialization
initializeDatabase();

// Handle errors
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

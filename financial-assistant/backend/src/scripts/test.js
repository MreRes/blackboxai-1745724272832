require('dotenv').config();
const mongoose = require('mongoose');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fetch = require('node-fetch');

class SystemTester {
    constructor() {
        this.results = {
            database: [],
            api: [],
            whatsapp: [],
            integration: []
        };
        this.testUser = {
            username: 'test_user',
            activationCode: 'TEST123',
            phoneNumber: '6281234567890'
        };
    }

    async runAllTests() {
        console.log('Starting system tests...\n');

        try {
            // Database Tests
            console.log('Running database tests...');
            await this.testDatabaseConnection();
            await this.testDatabaseOperations();
            console.log('Database tests completed.\n');

            // API Tests
            console.log('Running API tests...');
            await this.testAPIEndpoints();
            console.log('API tests completed.\n');

            // WhatsApp Tests
            console.log('Running WhatsApp tests...');
            await this.testWhatsAppConnection();
            await this.testMessageHandling();
            console.log('WhatsApp tests completed.\n');

            // Integration Tests
            console.log('Running integration tests...');
            await this.testUserFlow();
            await this.testTransactionFlow();
            await this.testBudgetFlow();
            console.log('Integration tests completed.\n');

            // Generate Report
            this.generateReport();

        } catch (error) {
            console.error('Test execution failed:', error);
            process.exit(1);
        }
    }

    // Database Tests
    async testDatabaseConnection() {
        try {
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            this.addResult('database', 'Connection', true, 'Successfully connected to database');
        } catch (error) {
            this.addResult('database', 'Connection', false, error.message);
            throw error;
        }
    }

    async testDatabaseOperations() {
        try {
            // Test User Collection
            const User = require('../models/user');
            await User.deleteOne({ username: this.testUser.username });
            const user = new User({
                username: this.testUser.username,
                activationCode: this.testUser.activationCode,
                maxPhoneNumbers: 1,
                expiryDate: new Date('2099-12-31')
            });
            await user.save();
            this.addResult('database', 'User Operations', true, 'Successfully performed user operations');

            // Test Transaction Collection
            const Transaction = require('../models/transaction');
            const transaction = new Transaction({
                user: user._id,
                type: 'expense',
                amount: 50000,
                category: 'Test',
                description: 'Test transaction',
                source: 'test'
            });
            await transaction.save();
            this.addResult('database', 'Transaction Operations', true, 'Successfully performed transaction operations');

            // Test Budget Collection
            const Budget = require('../models/budget');
            const budget = new Budget({
                user: user._id,
                name: 'Test Budget',
                type: 'expense',
                amount: 1000000,
                period: 'monthly',
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                categories: [{
                    name: 'Test',
                    amount: 1000000
                }]
            });
            await budget.save();
            this.addResult('database', 'Budget Operations', true, 'Successfully performed budget operations');

        } catch (error) {
            this.addResult('database', 'Database Operations', false, error.message);
            throw error;
        }
    }

    // API Tests
    async testAPIEndpoints() {
        const endpoints = [
            { method: 'POST', path: '/api/auth/register', data: { username: 'test_api_user' } },
            { method: 'GET', path: '/api/transactions' },
            { method: 'GET', path: '/api/budgets' },
            { method: 'GET', path: '/health' }
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(`http://localhost:${process.env.PORT}${endpoint.path}`, {
                    method: endpoint.method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.TEST_TOKEN}`
                    },
                    body: endpoint.data ? JSON.stringify(endpoint.data) : undefined
                });

                const success = response.status >= 200 && response.status < 300;
                this.addResult('api', `${endpoint.method} ${endpoint.path}`, success, 
                    success ? 'Endpoint responded successfully' : `Failed with status ${response.status}`);

            } catch (error) {
                this.addResult('api', `${endpoint.method} ${endpoint.path}`, false, error.message);
            }
        }
    }

    // WhatsApp Tests
    async testWhatsAppConnection() {
        try {
            const { stdout } = await execAsync('ps aux | grep whatsapp-web | grep -v grep');
            const isRunning = stdout.length > 0;
            this.addResult('whatsapp', 'Connection', isRunning, 
                isRunning ? 'WhatsApp process is running' : 'WhatsApp process is not running');
        } catch (error) {
            this.addResult('whatsapp', 'Connection', false, error.message);
        }
    }

    async testMessageHandling() {
        try {
            // Simulate message handling
            const message = {
                body: 'catat pengeluaran 50000 untuk makan',
                from: this.testUser.phoneNumber
            };

            const nlp = require('../utils/nlp');
            const result = await nlp.processMessage(message.body);

            this.addResult('whatsapp', 'Message Processing', 
                result.intent === 'transaction.expense', 
                'Successfully processed test message');

        } catch (error) {
            this.addResult('whatsapp', 'Message Processing', false, error.message);
        }
    }

    // Integration Tests
    async testUserFlow() {
        try {
            // Test user registration and activation flow
            const User = require('../models/user');
            const authHandler = require('../handlers/auth');

            // Register user
            const registration = await authHandler.createUser(
                'test_integration_user',
                false, // not admin
                1, // maxPhoneNumbers
                30 // expiryDays
            );

            // Activate user
            const activation = await authHandler.handleWhatsAppActivation(
                '6281234567891',
                registration.user.username,
                registration.user.activationCode
            );

            this.addResult('integration', 'User Registration Flow', 
                registration.success && activation.success,
                'Successfully completed user registration flow');

        } catch (error) {
            this.addResult('integration', 'User Registration Flow', false, error.message);
        }
    }

    async testTransactionFlow() {
        try {
            // Test complete transaction flow
            const transactionHandler = require('../handlers/transaction');
            const User = require('../models/user');

            const user = await User.findOne({ username: this.testUser.username });
            
            // Create transaction
            const transaction = await transactionHandler.createTransaction(
                user._id,
                {
                    type: 'expense',
                    amount: 75000,
                    category: 'Test Integration',
                    description: 'Integration test transaction'
                },
                'test'
            );

            // Get transactions
            const transactions = await transactionHandler.getTransactions(
                user._id,
                { limit: 10 }
            );

            this.addResult('integration', 'Transaction Flow',
                transaction.success && transactions.success,
                'Successfully completed transaction flow');

        } catch (error) {
            this.addResult('integration', 'Transaction Flow', false, error.message);
        }
    }

    async testBudgetFlow() {
        try {
            // Test complete budget flow
            const budgetHandler = require('../handlers/budget');
            const User = require('../models/user');

            const user = await User.findOne({ username: this.testUser.username });

            // Create budget
            const budget = await budgetHandler.createBudget(
                user._id,
                {
                    name: 'Integration Test Budget',
                    type: 'expense',
                    amount: 1000000,
                    period: 'monthly',
                    startDate: new Date(),
                    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    categories: [{
                        name: 'Test Integration',
                        amount: 1000000
                    }]
                }
            );

            // Get budgets
            const budgets = await budgetHandler.getBudgets(
                user._id,
                { status: 'active' }
            );

            this.addResult('integration', 'Budget Flow',
                budget.success && budgets.success,
                'Successfully completed budget flow');

        } catch (error) {
            this.addResult('integration', 'Budget Flow', false, error.message);
        }
    }

    // Helper Methods
    addResult(category, test, success, message) {
        this.results[category].push({
            test,
            success,
            message,
            timestamp: new Date()
        });
    }

    generateReport() {
        console.log('\n=== Test Report ===\n');

        let totalTests = 0;
        let passedTests = 0;

        // Process each category
        for (const [category, tests] of Object.entries(this.results)) {
            console.log(`${category.toUpperCase()} Tests:`);
            
            tests.forEach(test => {
                console.log(`  ${test.success ? '✓' : '✗'} ${test.test}: ${test.message}`);
                totalTests++;
                if (test.success) passedTests++;
            });
            
            console.log('');
        }

        // Summary
        const passRate = (passedTests / totalTests * 100).toFixed(2);
        console.log('Summary:');
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${totalTests - passedTests}`);
        console.log(`Pass Rate: ${passRate}%`);

        // Exit with appropriate code
        if (passedTests < totalTests) {
            process.exit(1);
        }
    }

    async cleanup() {
        try {
            // Clean up test data
            const User = require('../models/user');
            await User.deleteMany({ 
                username: { 
                    $in: [
                        this.testUser.username,
                        'test_api_user',
                        'test_integration_user'
                    ]
                }
            });

            // Close database connection
            await mongoose.connection.close();
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }
}

// Command line interface
const main = async () => {
    const tester = new SystemTester();
    
    try {
        await tester.runAllTests();
    } finally {
        await tester.cleanup();
    }
};

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = SystemTester;

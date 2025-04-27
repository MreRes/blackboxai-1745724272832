const Transaction = require('../models/transaction.js');
const Budget = require('../models/budget.js');
const nlp = require('../utils/nlp.js');
const moment = require('moment');

class TransactionHandler {
    // Create new transaction
    async createTransaction(userId, data, source = 'web') {
        try {
            const transaction = new Transaction({
                user: userId,
                type: data.type,
                amount: data.amount,
                category: data.category,
                description: data.description,
                date: data.date || new Date(),
                source: source,
                metadata: {
                    processedBy: data.processedBy || 'manual',
                    originalText: data.originalText
                }
            });

            // If there are attachments
            if (data.attachments) {
                transaction.attachments = data.attachments;
            }

            // Save transaction
            await transaction.save();

            // Update related budget if exists
            const budget = await this.updateRelatedBudget(userId, transaction);

            return {
                success: true,
                transaction,
                budgetUpdate: budget ? {
                    category: transaction.category,
                    remaining: budget.remaining,
                    isExceeded: budget.isExceeded()
                } : null
            };
        } catch (error) {
            console.error('Error creating transaction:', error);
            throw new Error('Gagal mencatat transaksi');
        }
    }

    // Process WhatsApp message for transaction
    async processWhatsAppTransaction(userId, message) {
        try {
            // Process message using NLP
            const processedData = await nlp.processMessage(message.body);

            if (!processedData.entities.amount || !processedData.entities.category) {
                return {
                    success: false,
                    message: 'Format pesan tidak valid. Contoh: "catat pengeluaran 50000 untuk makan"'
                };
            }

            // Create transaction data
            const transactionData = {
                type: processedData.intent.includes('expense') ? 'expense' : 'income',
                amount: processedData.entities.amount,
                category: processedData.entities.category,
                description: message.body,
                processedBy: 'ai',
                originalText: message.body
            };

            // If message has media
            if (message.hasMedia) {
                const media = await message.downloadMedia();
                transactionData.attachments = [{
                    type: media.mimetype.startsWith('image/') ? 'image' : 'document',
                    url: media.data, // You might want to store this in a proper file storage
                    processedText: '' // TODO: Implement OCR if needed
                }];
            }

            // Create transaction
            const result = await this.createTransaction(userId, transactionData, 'whatsapp');

            // Generate response message
            let response = `✅ Transaksi berhasil dicatat!\n\n`;
            response += `${transactionData.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}: Rp${transactionData.amount.toLocaleString('id')}\n`;
            response += `Kategori: ${transactionData.category}\n`;

            if (result.budgetUpdate) {
                response += `\nUpdate Budget ${result.budgetUpdate.category}:\n`;
                response += `Sisa: Rp${result.budgetUpdate.remaining.toLocaleString('id')}\n`;
                if (result.budgetUpdate.isExceeded) {
                    response += `⚠️ Budget telah terlampaui!`;
                }
            }

            return {
                success: true,
                message: response
            };
        } catch (error) {
            console.error('Error processing WhatsApp transaction:', error);
            throw new Error('Gagal memproses transaksi');
        }
    }

    // Get user transactions with filters
    async getTransactions(userId, filters = {}) {
        try {
            let query = { user: userId };

            // Apply date filters
            if (filters.startDate || filters.endDate) {
                query.date = {};
                if (filters.startDate) query.date.$gte = new Date(filters.startDate);
                if (filters.endDate) query.date.$lte = new Date(filters.endDate);
            }

            // Apply type filter
            if (filters.type) query.type = filters.type;

            // Apply category filter
            if (filters.category) query.category = filters.category;

            // Apply source filter
            if (filters.source) query.source = filters.source;

            const transactions = await Transaction.find(query)
                .sort({ date: -1 })
                .limit(filters.limit || 100);

            // Calculate totals
            const totals = await Transaction.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: '$type',
                        total: { $sum: '$amount' }
                    }
                }
            ]);

            const summary = {
                income: totals.find(t => t._id === 'income')?.total || 0,
                expense: totals.find(t => t._id === 'expense')?.total || 0
            };

            return {
                success: true,
                transactions,
                summary,
                balance: summary.income - summary.expense
            };
        } catch (error) {
            console.error('Error getting transactions:', error);
            throw new Error('Gagal mengambil data transaksi');
        }
    }

    // Update transaction
    async updateTransaction(userId, transactionId, updates) {
        try {
            const transaction = await Transaction.findOne({
                _id: transactionId,
                user: userId
            });

            if (!transaction) {
                return {
                    success: false,
                    message: 'Transaksi tidak ditemukan'
                };
            }

            // Update fields
            Object.assign(transaction, updates);
            await transaction.save();

            // Update related budget if amount or category changed
            if (updates.amount || updates.category) {
                await this.updateRelatedBudget(userId, transaction);
            }

            return {
                success: true,
                transaction
            };
        } catch (error) {
            console.error('Error updating transaction:', error);
            throw new Error('Gagal mengupdate transaksi');
        }
    }

    // Delete transaction
    async deleteTransaction(userId, transactionId) {
        try {
            const transaction = await Transaction.findOneAndDelete({
                _id: transactionId,
                user: userId
            });

            if (!transaction) {
                return {
                    success: false,
                    message: 'Transaksi tidak ditemukan'
                };
            }

            // Update related budget
            await this.updateRelatedBudget(userId, transaction, true);

            return {
                success: true,
                message: 'Transaksi berhasil dihapus'
            };
        } catch (error) {
            console.error('Error deleting transaction:', error);
            throw new Error('Gagal menghapus transaksi');
        }
    }

    // Update related budget
    async updateRelatedBudget(userId, transaction, isDelete = false) {
        try {
            const today = new Date();
            const budget = await Budget.findOne({
                user: userId,
                status: 'active',
                startDate: { $lte: today },
                endDate: { $gte: today },
                'categories.name': transaction.category
            });

            if (budget) {
                const amount = isDelete ? -transaction.amount : transaction.amount;
                await budget.updateCategorySpending(transaction.category, amount);
                return budget;
            }

            return null;
        } catch (error) {
            console.error('Error updating budget:', error);
            return null;
        }
    }

    // Get transaction statistics
    async getStatistics(userId, period = 'monthly') {
        try {
            const endDate = new Date();
            const startDate = new Date();

            switch (period) {
                case 'daily':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case 'monthly':
                    startDate.setMonth(startDate.getMonth() - 1);
                    break;
                case 'yearly':
                    startDate.setFullYear(startDate.getFullYear() - 1);
                    break;
            }

            const stats = await Transaction.aggregate([
                {
                    $match: {
                        user: userId,
                        date: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            type: '$type',
                            category: '$category',
                            date: {
                                $dateToString: {
                                    format: period === 'daily' ? '%Y-%m-%d' : '%Y-%m',
                                    date: '$date'
                                }
                            }
                        },
                        total: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: '$_id.type',
                        categories: {
                            $push: {
                                category: '$_id.category',
                                date: '$_id.date',
                                total: '$total',
                                count: '$count'
                            }
                        },
                        totalAmount: { $sum: '$total' }
                    }
                }
            ]);

            return {
                success: true,
                period,
                startDate,
                endDate,
                statistics: stats
            };
        } catch (error) {
            console.error('Error getting statistics:', error);
            throw new Error('Gagal mengambil statistik');
        }
    }
}

module.exports = new TransactionHandler();

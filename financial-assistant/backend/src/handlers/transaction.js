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
            const ocr = require('../utils/ocr');
            let ocrData = null;
            let mediaData = null;

            // Process image first if present to extract data
            if (message.hasMedia) {
                mediaData = await message.downloadMedia();
                if (mediaData.mimetype.startsWith('image/')) {
                    const ocrResult = await ocr.processImage(mediaData.data);
                    if (ocrResult.success) {
                        ocrData = ocrResult;
                        // If no text message provided, try to extract transaction details from receipt
                        if (!message.body) {
                            const amounts = ocrData.extractedData.amounts;
                            const merchants = ocrData.extractedData.merchants;
                            if (amounts.length > 0) {
                                message.body = `catat pengeluaran ${amounts[0]} untuk ${merchants[0] || 'belanja'}`;
                            }
                        }
                    }
                }
            }

            // Process message using NLP
            const processedData = await nlp.processMessage(message.body || '');

            // Handle multiple transactions
            if (processedData.intent === 'transaction.expense.multiple') {
                const transactions = await nlp.processMultipleTransactions(message.body);
                
                // If OCR data is available, try to match amounts with categories
                if (ocrData?.extractedData?.amounts) {
                    const amounts = ocrData.extractedData.amounts;
                    transactions.forEach((t, index) => {
                        if (!t.entities.amount && amounts[index]) {
                            t.entities.amount = amounts[index];
                        }
                    });
                }
                if (!transactions.length) {
                    return {
                        success: false,
                        message: 'Format transaksi ganda tidak valid. Contoh: "catat pengeluaran 50000 untuk makan dan 30000 untuk transport"'
                    };
                }

                const results = [];
                for (const transaction of transactions) {
                    const transactionData = await this.createTransactionData(
                        transaction, 
                        message,
                        mediaData,
                        ocrData
                    );
                    const result = await this.createTransaction(userId, transactionData, 'whatsapp');
                    results.push(result);
                }

                return {
                    success: true,
                    message: this.generateMultipleTransactionResponse(results)
                };
            }

            // Handle transaction editing
            if (processedData.intent === 'transaction.edit.last') {
                const lastTransaction = await Transaction.findOne({ user: userId }).sort({ date: -1 });
                if (!lastTransaction) {
                    return {
                        success: false,
                        message: 'Tidak ada transaksi yang dapat diedit.'
                    };
                }
                return {
                    success: true,
                    message: 'Silakan masukkan detail baru untuk transaksi terakhir.',
                    context: { action: 'edit', transactionId: lastTransaction._id }
                };
            }

            // Handle transaction deletion
            if (processedData.intent === 'transaction.delete.last') {
                const lastTransaction = await Transaction.findOne({ user: userId }).sort({ date: -1 });
                if (!lastTransaction) {
                    return {
                        success: false,
                        message: 'Tidak ada transaksi yang dapat dihapus.'
                    };
                }
                await this.deleteTransaction(userId, lastTransaction._id);
                return {
                    success: true,
                    message: 'Transaksi terakhir telah dihapus.'
                };
            }

            // Handle single transaction
            if (!processedData.entities.amount || !processedData.entities.category) {
                return {
                    success: false,
                    message: 'Format pesan tidak valid. Contoh: "catat pengeluaran 50000 untuk makan" atau "p50k makan"'
                };
            }

            // Handle single transaction
            const transactionData = await this.createTransactionData(
                processedData, 
                message, 
                mediaData, 
                ocrData
            );
            const result = await this.createTransaction(userId, transactionData, 'whatsapp');

            return {
                success: true,
                message: this.generateTransactionResponse(result)
            };
        } catch (error) {
            console.error('Error processing WhatsApp transaction:', error);
            throw new Error('Gagal memproses transaksi');
        }
    }

    // Get user transactions with filters
    async getTransactions(userId, filters = {}) {

    }

    async createTransactionData(processedData, message, mediaData = null, ocrData = null) {
        const transactionData = {
            type: processedData.intent.includes('expense') ? 'expense' : 'income',
            amount: processedData.entities.amount,
            category: processedData.entities.category,
            description: message.body || '',
            processedBy: 'ai',
            originalText: message.body || '',
            date: processedData.entities.date || new Date(),
            metadata: {
                ocrProcessed: false,
                confidence: processedData.confidence || 0
            }
        };

        // Enhance transaction data with OCR results if available
        if (ocrData?.success && ocrData.extractedData) {
            const { amounts, dates, merchants, items } = ocrData.extractedData;
            
            // Use OCR data to fill missing information
            if (!transactionData.amount && amounts.length > 0) {
                transactionData.amount = Math.max(...amounts);
                transactionData.metadata.amountSource = 'ocr';
            }

            if (!processedData.entities.date && dates.length > 0) {
                transactionData.date = new Date(dates[0]);
                transactionData.metadata.dateSource = 'ocr';
            }

            // Enhance description with merchant and items info
            let enhancedDescription = [];
            if (merchants.length > 0) {
                enhancedDescription.push(`Merchant: ${merchants[0]}`);
                if (!transactionData.category) {
                    // Try to infer category from merchant name
                    transactionData.category = this.inferCategoryFromMerchant(merchants[0]);
                    transactionData.metadata.categorySource = 'merchant';
                }
            }

            if (items.length > 0) {
                enhancedDescription.push(`Items: ${items.join(', ')}`);
            }

            if (enhancedDescription.length > 0) {
                transactionData.description = [
                    transactionData.description,
                    ...enhancedDescription
                ].filter(Boolean).join('\n');
            }

            transactionData.metadata.ocrProcessed = true;
            transactionData.metadata.ocrConfidence = ocrData.confidence || 0;
        }

        // Handle media attachment
        if (mediaData) {
            const isImage = mediaData.mimetype.startsWith('image/');
            transactionData.attachments = [{
                type: isImage ? 'image' : 'document',
                url: mediaData.data,
                mimetype: mediaData.mimetype,
                processedText: ocrData?.rawText || '',
                extractedData: ocrData?.extractedData || null
            }];
        }

        return transactionData;
    }

    inferCategoryFromMerchant(merchantName) {
        const merchantLower = merchantName.toLowerCase();
        const categoryPatterns = {
            'makanan': /(resto|restaurant|warung|cafe|kedai|makan|food|resto|cafe)/,
            'transportasi': /(transport|grab|gojek|taxi|bensin|parkir|toll)/,
            'belanja': /(mart|store|shop|market|mall|retail|toko)/,
            'utilitas': /(pln|pdam|pulsa|token|listrik|air|gas)/,
            'hiburan': /(cinema|movie|game|entertainment|bioskop)/
        };

        for (const [category, pattern] of Object.entries(categoryPatterns)) {
            if (pattern.test(merchantLower)) {
                return category;
            }
        }

        return 'lainnya';
    }

    generateTransactionResponse(result) {
        const { transaction, budgetUpdate } = result;
        const { metadata = {} } = transaction;
        
        let response = [`✅ Transaksi berhasil dicatat!`];

        // Transaction details
        response.push(
            `\n💰 ${transaction.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}: Rp${transaction.amount.toLocaleString('id')}` +
            (metadata.amountSource === 'ocr' ? ' (dari struk)' : '')
        );

        response.push(
            `📂 Kategori: ${transaction.category}` +
            (metadata.categorySource === 'merchant' ? ' (dari nama merchant)' : '')
        );

        // Add description if it contains OCR-extracted information
        if (transaction.description && (transaction.description.includes('Merchant:') || transaction.description.includes('Items:'))) {
            response.push(`\n📝 Detail:`);
            const details = transaction.description.split('\n').filter(Boolean);
            response.push(...details.map(d => `  ${d}`));
        }

        // Budget information
        if (budgetUpdate) {
            response.push(
                `\n💼 Update Budget ${budgetUpdate.category}:`,
                `  Sisa: Rp${budgetUpdate.remaining.toLocaleString('id')}`
            );
            
            if (budgetUpdate.isExceeded) {
                response.push(`⚠️ Budget telah terlampaui!`);
            }
        }

        // OCR processing info
        if (metadata.ocrProcessed) {
            response.push(
                `\nℹ️ Struk berhasil diproses` + 
                (metadata.ocrConfidence ? ` (akurasi ${Math.round(metadata.ocrConfidence * 100)}%)` : '')
            );
        }

        return response.join('\n');
    }

    generateMultipleTransactionResponse(results) {
        let response = [`✅ ${results.length} transaksi berhasil dicatat!`];
        
        // Group transactions by source (OCR vs manual)
        const ocrTransactions = results.filter(r => r.transaction.metadata?.ocrProcessed);
        const manualTransactions = results.filter(r => !r.transaction.metadata?.ocrProcessed);

        // Display OCR-processed transactions first
        if (ocrTransactions.length > 0) {
            response.push('\n📷 Transaksi dari struk:');
            ocrTransactions.forEach((result, index) => {
                const { transaction, budgetUpdate } = result;
                const { metadata = {} } = transaction;

                response.push(
                    `${index + 1}. ${transaction.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}: ` +
                    `Rp${transaction.amount.toLocaleString('id')} untuk ${transaction.category}`
                );

                // Add merchant/items if available
                if (transaction.description) {
                    const details = transaction.description
                        .split('\n')
                        .filter(line => line.startsWith('Merchant:') || line.startsWith('Items:'))
                        .map(line => `   ${line}`);
                    if (details.length > 0) {
                        response.push(...details);
                    }
                }

                // Add budget warning if exceeded
                if (budgetUpdate?.isExceeded) {
                    response.push(`   ⚠️ Budget ${transaction.category} telah terlampaui!`);
                }
            });
        }

        // Display manually entered transactions
        if (manualTransactions.length > 0) {
            if (ocrTransactions.length > 0) {
                response.push('\n✍️ Transaksi manual:');
            }
            manualTransactions.forEach((result, index) => {
                const { transaction, budgetUpdate } = result;
                const displayIndex = ocrTransactions.length + index + 1;

                response.push(
                    `${displayIndex}. ${transaction.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}: ` +
                    `Rp${transaction.amount.toLocaleString('id')} untuk ${transaction.category}`
                );

                if (budgetUpdate?.isExceeded) {
                    response.push(`   ⚠️ Budget ${transaction.category} telah terlampaui!`);
                }
            });
        }

        // Add OCR processing summary if applicable
        if (ocrTransactions.length > 0) {
            const avgConfidence = ocrTransactions
                .reduce((sum, r) => sum + (r.transaction.metadata?.ocrConfidence || 0), 0) / ocrTransactions.length;
            
            response.push(
                `\nℹ️ ${ocrTransactions.length} transaksi diproses dari struk` +
                (avgConfidence ? ` (rata-rata akurasi ${Math.round(avgConfidence * 100)}%)` : '')
            );
        }

        return response.join('\n');
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

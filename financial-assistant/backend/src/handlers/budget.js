const Budget = require('../models/budget.js');
const Transaction = require('../models/transaction.js');
const moment = require('moment');

class BudgetHandler {
    // Create new budget
    async createBudget(userId, data) {
        try {
            // Validate dates
            const startDate = new Date(data.startDate);
            const endDate = new Date(data.endDate);

            if (startDate >= endDate) {
                return {
                    success: false,
                    message: 'Tanggal mulai harus lebih awal dari tanggal berakhir'
                };
            }

            // Check for overlapping budgets in the same category
            const existingBudget = await Budget.findOne({
                user: userId,
                status: 'active',
                categories: { 
                    $elemMatch: { 
                        name: { $in: data.categories.map(c => c.name) }
                    }
                },
                startDate: { $lte: endDate },
                endDate: { $gte: startDate }
            });

            if (existingBudget) {
                return {
                    success: false,
                    message: 'Terdapat budget aktif yang overlap untuk kategori yang sama'
                };
            }

            // Create budget
            const budget = new Budget({
                user: userId,
                name: data.name,
                type: data.type,
                amount: data.amount,
                period: data.period,
                startDate,
                endDate,
                categories: data.categories,
                notifications: data.notifications,
                recurring: data.recurring,
                metadata: {
                    createdVia: data.source || 'web'
                }
            });

            await budget.save();

            // Initialize spending from existing transactions
            await this.initializeSpending(budget);

            return {
                success: true,
                budget
            };
        } catch (error) {
            console.error('Error creating budget:', error);
            throw new Error('Gagal membuat budget');
        }
    }

    // Initialize budget spending from existing transactions
    async initializeSpending(budget) {
        try {
            const transactions = await Transaction.find({
                user: budget.user,
                category: { $in: budget.categories.map(c => c.name) },
                date: { $gte: budget.startDate, $lte: budget.endDate }
            });

            for (const transaction of transactions) {
                const category = budget.categories.find(c => c.name === transaction.category);
                if (category) {
                    category.spent += transaction.amount;
                }
            }

            await budget.save();
        } catch (error) {
            console.error('Error initializing spending:', error);
        }
    }

    // Get user's budgets with filters
    async getBudgets(userId, filters = {}) {
        try {
            let query = { user: userId };

            // Apply status filter
            if (filters.status) {
                query.status = filters.status;
            }

            // Apply date filters
            if (filters.date) {
                const date = new Date(filters.date);
                query.startDate = { $lte: date };
                query.endDate = { $gte: date };
            }

            const budgets = await Budget.find(query).sort({ startDate: -1 });

            // Calculate additional statistics for each budget
            const budgetsWithStats = await Promise.all(budgets.map(async budget => {
                const stats = await this.calculateBudgetStatistics(budget);
                return {
                    ...budget.toObject(),
                    statistics: stats
                };
            }));

            return {
                success: true,
                budgets: budgetsWithStats
            };
        } catch (error) {
            console.error('Error getting budgets:', error);
            throw new Error('Gagal mengambil data budget');
        }
    }

    // Calculate budget statistics
    async calculateBudgetStatistics(budget) {
        try {
            const now = new Date();
            const totalDays = (budget.endDate - budget.startDate) / (1000 * 60 * 60 * 24);
            const daysPassed = Math.min(
                (now - budget.startDate) / (1000 * 60 * 60 * 24),
                totalDays
            );

            const totalSpent = budget.categories.reduce((sum, cat) => sum + cat.spent, 0);
            const totalBudget = budget.amount;
            const dailyBudget = totalBudget / totalDays;
            const idealSpentToDate = dailyBudget * daysPassed;

            return {
                progress: (totalSpent / totalBudget) * 100,
                remaining: totalBudget - totalSpent,
                daysRemaining: Math.max(0, Math.ceil((budget.endDate - now) / (1000 * 60 * 60 * 24))),
                dailyBudget,
                idealSpentToDate,
                variance: idealSpentToDate - totalSpent,
                isOverBudget: totalSpent > totalBudget,
                projectedTotal: (totalSpent / daysPassed) * totalDays
            };
        } catch (error) {
            console.error('Error calculating statistics:', error);
            return null;
        }
    }

    // Update budget
    async updateBudget(userId, budgetId, updates) {
        try {
            const budget = await Budget.findOne({
                _id: budgetId,
                user: userId
            });

            if (!budget) {
                return {
                    success: false,
                    message: 'Budget tidak ditemukan'
                };
            }

            // Don't allow updating completed or cancelled budgets
            if (budget.status !== 'active') {
                return {
                    success: false,
                    message: 'Hanya budget aktif yang dapat diupdate'
                };
            }

            // Update allowed fields
            const allowedUpdates = [
                'name', 'amount', 'categories', 'notifications', 
                'endDate', 'status'
            ];

            allowedUpdates.forEach(field => {
                if (updates[field] !== undefined) {
                    budget[field] = updates[field];
                }
            });

            await budget.save();

            return {
                success: true,
                budget
            };
        } catch (error) {
            console.error('Error updating budget:', error);
            throw new Error('Gagal mengupdate budget');
        }
    }

    // Process WhatsApp budget command
    async processWhatsAppBudget(userId, message) {
        try {
            const command = message.body.toLowerCase();
            let response = '';

            if (command === 'lihat budget') {
                // Get active budgets
                const { budgets } = await this.getBudgets(userId, { status: 'active' });
                
                if (budgets.length === 0) {
                    return {
                        success: true,
                        message: 'Tidak ada budget aktif saat ini.'
                    };
                }

                response = '📊 *Budget Aktif*\n\n';
                for (const budget of budgets) {
                    response += `*${budget.name}*\n`;
                    response += `Period: ${moment(budget.startDate).format('DD/MM/YY')} - ${moment(budget.endDate).format('DD/MM/YY')}\n`;
                    response += `Total: Rp${budget.amount.toLocaleString('id')}\n`;
                    response += `Terpakai: Rp${budget.statistics.totalSpent.toLocaleString('id')} (${Math.round(budget.statistics.progress)}%)\n`;
                    response += `Sisa: Rp${budget.statistics.remaining.toLocaleString('id')}\n\n`;
                    
                    if (budget.statistics.isOverBudget) {
                        response += '⚠️ *Budget terlampaui!*\n';
                    }
                    response += '-------------------\n';
                }
            } else {
                response = 'Perintah tidak dikenali. Gunakan "lihat budget" untuk melihat budget aktif.';
            }

            return {
                success: true,
                message: response
            };
        } catch (error) {
            console.error('Error processing WhatsApp budget command:', error);
            throw new Error('Gagal memproses perintah budget');
        }
    }

    // Get budget recommendations
    async getBudgetRecommendations(userId) {
        try {
            // Get user's transaction history
            const threeMonthsAgo = moment().subtract(3, 'months').toDate();
            const transactions = await Transaction.find({
                user: userId,
                date: { $gte: threeMonthsAgo }
            });

            // Calculate average monthly spending by category
            const categoryTotals = {};
            transactions.forEach(transaction => {
                if (!categoryTotals[transaction.category]) {
                    categoryTotals[transaction.category] = {
                        total: 0,
                        count: 0
                    };
                }
                categoryTotals[transaction.category].total += transaction.amount;
                categoryTotals[transaction.category].count++;
            });

            // Generate recommendations
            const recommendations = Object.entries(categoryTotals).map(([category, data]) => {
                const monthlyAverage = data.total / 3; // 3 months
                const recommendedBudget = Math.ceil(monthlyAverage * 1.1); // 10% buffer

                return {
                    category,
                    recommendedBudget,
                    basedOn: {
                        transactions: data.count,
                        monthlyAverage,
                        period: '3 months'
                    }
                };
            });

            return {
                success: true,
                recommendations: recommendations.sort((a, b) => b.recommendedBudget - a.recommendedBudget)
            };
        } catch (error) {
            console.error('Error generating budget recommendations:', error);
            throw new Error('Gagal membuat rekomendasi budget');
        }
    }
}

module.exports = new BudgetHandler();

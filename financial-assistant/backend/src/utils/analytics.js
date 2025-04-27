const mongoose = require('mongoose');
const moment = require('moment');
const validator = require('./validator');
const logger = require('./logger');

class Analytics {
    // Get user's financial overview
    async getFinancialOverview(userId, period = 'monthly') {
        try {
            const Transaction = require('../models/transaction');
            const Budget = require('../models/budget');

            const now = new Date();
            let startDate, endDate;

            // Set date range based on period
            switch (period) {
                case 'daily':
                    startDate = moment().startOf('day');
                    endDate = moment().endOf('day');
                    break;
                case 'weekly':
                    startDate = moment().startOf('week');
                    endDate = moment().endOf('week');
                    break;
                case 'monthly':
                    startDate = moment().startOf('month');
                    endDate = moment().endOf('month');
                    break;
                case 'yearly':
                    startDate = moment().startOf('year');
                    endDate = moment().endOf('year');
                    break;
                default:
                    throw new Error('Invalid period');
            }

            // Get transactions
            const transactions = await Transaction.find({
                user: userId,
                date: {
                    $gte: startDate.toDate(),
                    $lte: endDate.toDate()
                }
            });

            // Get active budgets
            const budgets = await Budget.find({
                user: userId,
                status: 'active',
                startDate: { $lte: now },
                endDate: { $gte: now }
            });

            // Calculate totals
            const totals = {
                income: 0,
                expense: 0
            };

            transactions.forEach(t => {
                totals[t.type] += t.amount;
            });

            // Calculate category breakdown
            const categoryBreakdown = transactions.reduce((acc, t) => {
                if (!acc[t.type]) acc[t.type] = {};
                if (!acc[t.type][t.category]) acc[t.type][t.category] = 0;
                acc[t.type][t.category] += t.amount;
                return acc;
            }, {});

            // Calculate budget progress
            const budgetProgress = budgets.map(budget => {
                const spent = transactions
                    .filter(t => t.type === 'expense' && budget.categories.some(c => c.name === t.category))
                    .reduce((sum, t) => sum + t.amount, 0);

                return {
                    name: budget.name,
                    amount: budget.amount,
                    spent,
                    remaining: budget.amount - spent,
                    progress: (spent / budget.amount) * 100
                };
            });

            return {
                period,
                dateRange: {
                    start: startDate.toDate(),
                    end: endDate.toDate()
                },
                totals,
                balance: totals.income - totals.expense,
                categoryBreakdown,
                budgetProgress,
                transactionCount: transactions.length
            };
        } catch (error) {
            logger.error(error, { type: 'financial_overview_error', userId });
            throw error;
        }
    }

    // Get spending patterns
    async getSpendingPatterns(userId, months = 3) {
        try {
            const Transaction = require('../models/transaction');
            
            const startDate = moment().subtract(months, 'months').startOf('month');
            const transactions = await Transaction.find({
                user: userId,
                type: 'expense',
                date: { $gte: startDate.toDate() }
            });

            // Daily spending patterns
            const dailyPatterns = Array(7).fill(0);
            transactions.forEach(t => {
                const day = moment(t.date).day();
                dailyPatterns[day] += t.amount;
            });

            // Normalize daily patterns
            const totalDays = moment().diff(startDate, 'days');
            const weeksPerDay = Math.ceil(totalDays / 7);
            dailyPatterns.forEach((amount, index) => {
                dailyPatterns[index] = amount / weeksPerDay;
            });

            // Monthly spending patterns
            const monthlyPatterns = {};
            transactions.forEach(t => {
                const month = moment(t.date).format('YYYY-MM');
                if (!monthlyPatterns[month]) monthlyPatterns[month] = 0;
                monthlyPatterns[month] += t.amount;
            });

            // Category patterns
            const categoryPatterns = {};
            transactions.forEach(t => {
                if (!categoryPatterns[t.category]) {
                    categoryPatterns[t.category] = {
                        total: 0,
                        count: 0,
                        average: 0
                    };
                }
                categoryPatterns[t.category].total += t.amount;
                categoryPatterns[t.category].count++;
            });

            Object.values(categoryPatterns).forEach(cat => {
                cat.average = cat.total / cat.count;
            });

            return {
                dailyPatterns: {
                    data: dailyPatterns,
                    labels: moment.weekdays()
                },
                monthlyPatterns: {
                    data: Object.values(monthlyPatterns),
                    labels: Object.keys(monthlyPatterns)
                },
                categoryPatterns,
                averageDailySpending: transactions.reduce((sum, t) => sum + t.amount, 0) / totalDays
            };
        } catch (error) {
            logger.error(error, { type: 'spending_patterns_error', userId });
            throw error;
        }
    }

    // Get budget recommendations
    async getBudgetRecommendations(userId) {
        try {
            const Transaction = require('../models/transaction');
            
            // Get last 3 months of transactions
            const startDate = moment().subtract(3, 'months').startOf('month');
            const transactions = await Transaction.find({
                user: userId,
                type: 'expense',
                date: { $gte: startDate.toDate() }
            });

            // Calculate average monthly spending by category
            const categoryAverages = {};
            transactions.forEach(t => {
                if (!categoryAverages[t.category]) {
                    categoryAverages[t.category] = {
                        total: 0,
                        count: 0
                    };
                }
                categoryAverages[t.category].total += t.amount;
                categoryAverages[t.category].count++;
            });

            // Generate recommendations
            const recommendations = Object.entries(categoryAverages).map(([category, data]) => {
                const monthlyAverage = data.total / 3; // 3 months
                const recommendedBudget = Math.ceil(monthlyAverage * 1.1); // 10% buffer

                return {
                    category,
                    recommendedBudget,
                    monthlyAverage,
                    frequency: data.count / 3, // Average transactions per month
                    confidence: Math.min((data.count / 30) * 100, 100) // Confidence based on data points
                };
            });

            return recommendations.sort((a, b) => b.recommendedBudget - a.recommendedBudget);
        } catch (error) {
            logger.error(error, { type: 'budget_recommendations_error', userId });
            throw error;
        }
    }

    // Get financial health score
    async getFinancialHealth(userId) {
        try {
            const Transaction = require('../models/transaction');
            const Budget = require('../models/budget');

            // Get last month's data
            const startDate = moment().subtract(1, 'month').startOf('month');
            const endDate = moment().subtract(1, 'month').endOf('month');

            const transactions = await Transaction.find({
                user: userId,
                date: {
                    $gte: startDate.toDate(),
                    $lte: endDate.toDate()
                }
            });

            const budgets = await Budget.find({
                user: userId,
                startDate: { $lte: endDate.toDate() },
                endDate: { $gte: startDate.toDate() }
            });

            // Calculate metrics
            const metrics = {
                savingsRate: 0,
                budgetAdherence: 0,
                expenseStability: 0,
                incomeStability: 0
            };

            // Calculate savings rate
            const income = transactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + t.amount, 0);
            
            const expenses = transactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + t.amount, 0);

            metrics.savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;

            // Calculate budget adherence
            if (budgets.length > 0) {
                const adherenceScores = budgets.map(budget => {
                    const spent = transactions
                        .filter(t => t.type === 'expense' && budget.categories.some(c => c.name === t.category))
                        .reduce((sum, t) => sum + t.amount, 0);
                    
                    const adherence = Math.min(spent / budget.amount, 1);
                    return Math.abs(1 - adherence);
                });

                metrics.budgetAdherence = (1 - (adherenceScores.reduce((a, b) => a + b, 0) / adherenceScores.length)) * 100;
            }

            // Calculate expense stability
            const dailyExpenses = {};
            transactions
                .filter(t => t.type === 'expense')
                .forEach(t => {
                    const day = moment(t.date).format('YYYY-MM-DD');
                    if (!dailyExpenses[day]) dailyExpenses[day] = 0;
                    dailyExpenses[day] += t.amount;
                });

            const expenseValues = Object.values(dailyExpenses);
            if (expenseValues.length > 0) {
                const avgExpense = expenseValues.reduce((a, b) => a + b, 0) / expenseValues.length;
                const expenseVariance = expenseValues.reduce((sum, val) => sum + Math.pow(val - avgExpense, 2), 0) / expenseValues.length;
                metrics.expenseStability = Math.max(0, 100 - (expenseVariance / avgExpense));
            }

            // Calculate overall score
            const weights = {
                savingsRate: 0.4,
                budgetAdherence: 0.3,
                expenseStability: 0.3
            };

            const score = Object.entries(weights).reduce((score, [metric, weight]) => {
                return score + (metrics[metric] * weight);
            }, 0);

            // Generate recommendations
            const recommendations = [];

            if (metrics.savingsRate < 20) {
                recommendations.push({
                    type: 'savings',
                    message: 'Tingkatkan rasio tabungan Anda dengan mengurangi pengeluaran tidak penting'
                });
            }

            if (metrics.budgetAdherence < 70) {
                recommendations.push({
                    type: 'budget',
                    message: 'Cobalah untuk lebih mengikuti anggaran yang telah ditetapkan'
                });
            }

            if (metrics.expenseStability < 60) {
                recommendations.push({
                    type: 'stability',
                    message: 'Usahakan pengeluaran lebih stabil dan terencana'
                });
            }

            return {
                score: Math.round(score),
                metrics,
                recommendations,
                lastUpdated: new Date()
            };
        } catch (error) {
            logger.error(error, { type: 'financial_health_error', userId });
            throw error;
        }
    }

    // Get transaction insights
    async getTransactionInsights(userId) {
        try {
            const Transaction = require('../models/transaction');

            // Get transactions from last 6 months
            const startDate = moment().subtract(6, 'months').startOf('month');
            const transactions = await Transaction.find({
                user: userId,
                date: { $gte: startDate.toDate() }
            });

            const insights = {
                unusualTransactions: [],
                recurringTransactions: [],
                topMerchants: [],
                spendingTrends: []
            };

            // Find unusual transactions
            const categoryAverages = {};
            transactions.forEach(t => {
                if (!categoryAverages[t.category]) {
                    categoryAverages[t.category] = {
                        amounts: [],
                        mean: 0,
                        stdDev: 0
                    };
                }
                categoryAverages[t.category].amounts.push(t.amount);
            });

            // Calculate mean and standard deviation for each category
            Object.values(categoryAverages).forEach(cat => {
                cat.mean = cat.amounts.reduce((a, b) => a + b, 0) / cat.amounts.length;
                cat.stdDev = Math.sqrt(
                    cat.amounts.reduce((sum, val) => sum + Math.pow(val - cat.mean, 2), 0) / cat.amounts.length
                );
            });

            // Find transactions more than 2 standard deviations from mean
            transactions.forEach(t => {
                const stats = categoryAverages[t.category];
                if (Math.abs(t.amount - stats.mean) > stats.stdDev * 2) {
                    insights.unusualTransactions.push({
                        transaction: t,
                        difference: t.amount - stats.mean
                    });
                }
            });

            // Find recurring transactions
            const potentialRecurring = transactions.reduce((acc, t) => {
                const key = `${t.category}-${t.amount}`;
                if (!acc[key]) acc[key] = [];
                acc[key].push(t.date);
                return acc;
            }, {});

            Object.entries(potentialRecurring).forEach(([key, dates]) => {
                if (dates.length >= 3) { // At least 3 occurrences
                    const intervals = [];
                    for (let i = 1; i < dates.length; i++) {
                        intervals.push(moment(dates[i]).diff(moment(dates[i-1]), 'days'));
                    }

                    // Check if intervals are consistent (within 3 days)
                    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                    const isConsistent = intervals.every(i => Math.abs(i - avgInterval) <= 3);

                    if (isConsistent) {
                        const [category, amount] = key.split('-');
                        insights.recurringTransactions.push({
                            category,
                            amount: parseFloat(amount),
                            interval: Math.round(avgInterval),
                            occurrences: dates.length
                        });
                    }
                }
            });

            // Calculate spending trends
            const monthlyTotals = {};
            transactions.forEach(t => {
                const month = moment(t.date).format('YYYY-MM');
                if (!monthlyTotals[month]) monthlyTotals[month] = 0;
                if (t.type === 'expense') monthlyTotals[month] += t.amount;
            });

            const months = Object.keys(monthlyTotals).sort();
            for (let i = 1; i < months.length; i++) {
                const currentMonth = monthlyTotals[months[i]];
                const previousMonth = monthlyTotals[months[i-1]];
                const change = ((currentMonth - previousMonth) / previousMonth) * 100;

                if (Math.abs(change) > 20) { // Significant change (>20%)
                    insights.spendingTrends.push({
                        month: months[i],
                        change: change,
                        amount: currentMonth
                    });
                }
            }

            return insights;
        } catch (error) {
            logger.error(error, { type: 'transaction_insights_error', userId });
            throw error;
        }
    }
}

module.exports = new Analytics();

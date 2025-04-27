const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['expense', 'income', 'savings'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    period: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'],
        required: true
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    categories: [{
        name: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        spent: {
            type: Number,
            default: 0
        },
        color: {
            type: String,
            default: '#000000'
        }
    }],
    notifications: {
        enabled: {
            type: Boolean,
            default: true
        },
        threshold: {
            type: Number,
            default: 80 // percentage
        },
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly', 'on_threshold'],
            default: 'on_threshold'
        }
    },
    recurring: {
        isRecurring: {
            type: Boolean,
            default: false
        },
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly', 'yearly'],
        },
        endDate: Date
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'cancelled'],
        default: 'active'
    },
    metadata: {
        createdVia: {
            type: String,
            enum: ['web', 'whatsapp', 'system'],
            required: true
        },
        lastNotification: Date,
        aiSuggestions: [{
            suggestion: String,
            reason: String,
            date: Date
        }]
    }
}, {
    timestamps: true
});

// Indexes
budgetSchema.index({ user: 1, status: 1 });
budgetSchema.index({ user: 1, startDate: 1, endDate: 1 });

// Virtual for progress percentage
budgetSchema.virtual('progress').get(function() {
    const totalSpent = this.categories.reduce((sum, cat) => sum + cat.spent, 0);
    return (totalSpent / this.amount) * 100;
});

// Virtual for remaining amount
budgetSchema.virtual('remaining').get(function() {
    const totalSpent = this.categories.reduce((sum, cat) => sum + cat.spent, 0);
    return this.amount - totalSpent;
});

// Method to check if budget is exceeded
budgetSchema.methods.isExceeded = function() {
    return this.progress > 100;
};

// Method to update category spending
budgetSchema.methods.updateCategorySpending = async function(categoryName, amount) {
    const category = this.categories.find(cat => cat.name === categoryName);
    if (category) {
        category.spent += amount;
        await this.save();
    }
};

// Method to get budget status with predictions
budgetSchema.methods.getStatus = function() {
    const today = new Date();
    const totalDays = (this.endDate - this.startDate) / (1000 * 60 * 60 * 24);
    const daysPassed = (today - this.startDate) / (1000 * 60 * 60 * 24);
    const idealSpendingRate = this.amount / totalDays;
    const actualSpendingRate = this.categories.reduce((sum, cat) => sum + cat.spent, 0) / daysPassed;

    return {
        progress: this.progress,
        remaining: this.remaining,
        daysRemaining: Math.max(0, Math.ceil((this.endDate - today) / (1000 * 60 * 60 * 24))),
        isOverBudget: this.isExceeded(),
        spendingRate: {
            ideal: idealSpendingRate,
            actual: actualSpendingRate,
            difference: idealSpendingRate - actualSpendingRate
        },
        prediction: {
            estimatedTotal: actualSpendingRate * totalDays,
            willExceed: (actualSpendingRate * totalDays) > this.amount
        }
    };
};

// Static method to get active budgets for user
budgetSchema.statics.getActiveBudgets = async function(userId) {
    const today = new Date();
    return await this.find({
        user: userId,
        status: 'active',
        startDate: { $lte: today },
        endDate: { $gte: today }
    });
};

const Budget = mongoose.model('Budget', budgetSchema);

module.exports = Budget;

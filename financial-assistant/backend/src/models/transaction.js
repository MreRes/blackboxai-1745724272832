const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['income', 'expense'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    category: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    source: {
        type: String,
        enum: ['whatsapp', 'web', 'system'],
        required: true
    },
    attachments: [{
        type: {
            type: String,
            enum: ['image', 'voice', 'document'],
        },
        url: String,
        processedText: String // For OCR results
    }],
    location: {
        type: {
            type: String,
            enum: ['Point'],
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
        }
    },
    tags: [{
        type: String,
        trim: true
    }],
    budget: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Budget'
    },
    metadata: {
        processedBy: String, // 'manual' or 'ai'
        confidence: Number, // AI confidence score
        originalText: String, // Original message text
        corrections: [{ // NLP corrections
            original: String,
            corrected: String,
            type: String // 'spelling', 'grammar', 'context'
        }]
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'cancelled'],
        default: 'completed'
    }
}, {
    timestamps: true
});

// Indexes for better query performance
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ user: 1, type: 1 });
transactionSchema.index({ user: 1, category: 1 });

// Virtual for formatted amount
transactionSchema.virtual('formattedAmount').get(function() {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(this.amount);
});

// Method to categorize transaction using AI
transactionSchema.methods.autoCategorizeTags = async function() {
    // TODO: Implement AI categorization
    return this.tags;
};

// Static method to get user's statistics
transactionSchema.statics.getUserStats = async function(userId, startDate, endDate) {
    return await this.aggregate([
        {
            $match: {
                user: mongoose.Types.ObjectId(userId),
                date: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: '$type',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
                categories: {
                    $addToSet: '$category'
                }
            }
        }
    ]);
};

// Method to get related transactions
transactionSchema.methods.getRelated = async function() {
    return await this.model('Transaction').find({
        user: this.user,
        category: this.category,
        _id: { $ne: this._id }
    }).limit(5);
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;

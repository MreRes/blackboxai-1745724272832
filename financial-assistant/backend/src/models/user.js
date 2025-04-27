const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    activationCode: {
        type: String,
        required: true
    },
    phoneNumbers: [{
        number: {
            type: String,
            required: true,
            unique: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        activatedAt: {
            type: Date,
            default: Date.now
        }
    }],
    maxPhoneNumbers: {
        type: Number,
        default: 1
    },
    expiryDate: {
        type: Date,
        required: true
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    password: {
        type: String,
        required: function() {
            return this.isAdmin;
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    if (this.isModified('activationCode')) {
        this.activationCode = await bcrypt.hash(this.activationCode, 10);
    }
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Compare activation code
userSchema.methods.compareActivationCode = async function(candidateCode) {
    return await bcrypt.compare(candidateCode, this.activationCode);
};

// Check if phone number limit is reached
userSchema.methods.canAddPhoneNumber = function() {
    return this.phoneNumbers.length < this.maxPhoneNumbers;
};

// Check if subscription is active
userSchema.methods.isSubscriptionActive = function() {
    return new Date() < this.expiryDate;
};

// Add phone number
userSchema.methods.addPhoneNumber = function(number) {
    if (!this.canAddPhoneNumber()) {
        throw new Error('Phone number limit reached');
    }
    
    if (this.phoneNumbers.some(phone => phone.number === number)) {
        throw new Error('Phone number already registered');
    }

    this.phoneNumbers.push({ number });
};

// Remove phone number
userSchema.methods.removePhoneNumber = function(number) {
    this.phoneNumbers = this.phoneNumbers.filter(phone => phone.number !== number);
};

const User = mongoose.model('User', userSchema);

module.exports = User;

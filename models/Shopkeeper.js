const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const shopkeeperSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String },
    shopName: { type: String },
    fcmToken: { type: String, default: null },
    referredByPhone: { type: String, default: null },


    // Role: 'admin' can see all devices & all shopkeepers
    //       'shopkeeper' can only see their own devices
    role: {
        type: String,
        enum: ['admin', 'shopkeeper'],
        default: 'shopkeeper'
    },

    isActive: { type: Boolean, default: true },

    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
shopkeeperSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// Compare password
shopkeeperSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Shopkeeper', shopkeeperSchema);

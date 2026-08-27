const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const shopkeeperSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    shopName: { type: String },
    fcmToken: { type: String, default: null },
    referredByPhone: { type: String, default: null },
    referralRewardClaimed: { type: Boolean, default: false }, // Has the referrer been rewarded for this signup?

    // Set only on shopkeepers created by a dealer (via POST /api/dealer/shopkeepers).
    // Null for shopkeepers/dealers created directly by admin.
    dealer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        default: null
    },

    // Role: 'admin' can see all devices & all shopkeepers
    //       'dealer' creates shopkeeper accounts and distributes keys to them —
    //                 no device/EMI/customer data visibility at all
    //       'shopkeeper' can only see their own devices
    role: {
        type: String,
        enum: ['admin', 'dealer', 'shopkeeper'],
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

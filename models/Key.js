const mongoose = require('mongoose');

// One document per shopkeeper per platform.
// Admin allocates keys; each device registration consumes 1 key.
const keySchema = new mongoose.Schema({
    shopkeeper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        required: true
    },

    platform: {
        type: String,
        enum: ['android', 'ios'],
        required: true
    },

    totalKeys: { type: Number, default: 0 },
    usedKeys: { type: Number, default: 0 },

    updatedAt: { type: Date, default: Date.now }
});

// Compound unique: one record per shopkeeper+platform
keySchema.index({ shopkeeper: 1, platform: 1 }, { unique: true });

// Virtual: available keys
keySchema.virtual('availableKeys').get(function () {
    return this.totalKeys - this.usedKeys;
});

keySchema.set('toJSON', { virtuals: true });
keySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Key', keySchema);


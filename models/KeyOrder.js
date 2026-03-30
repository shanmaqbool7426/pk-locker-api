const mongoose = require('mongoose');

const keyOrderSchema = new mongoose.Schema({
    shopkeeper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        required: true
    },
    numKeys: {
        type: Number,
        required: true,
        min: 1
    },
    unitPrice: {
        type: Number,
        default: 300 // PKR 300 per key
    },
    totalAmount: {
        type: Number,
        required: true
    },
    paymentProofImage: {
        type: String, // Base64 or URL to screenshot
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    platform: {
        type: String,
        enum: ['android', 'ios'],
        default: 'android'
    },
    trackerId: {
        type: String,
        default: ''
    },
    adminNotes: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('KeyOrder', keyOrderSchema);

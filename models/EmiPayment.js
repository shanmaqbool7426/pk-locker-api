const mongoose = require('mongoose');

const emiPaymentSchema = new mongoose.Schema({
    device: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Device',
        required: true
    },
    imei: { type: String, required: true }, // denormalized for fast queries

    shopkeeper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        required: true
    },

    // Installment number (1, 2, 3 ... emiTenure)
    installmentNumber: { type: Number, required: true },

    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },       // Total installment amount

    // Partial payment tracking
    paidAmount: { type: Number, default: 0 },        // How much has been paid so far

    status: {
        type: String,
        enum: ['Paid', 'Partial', 'Unpaid'],
        default: 'Unpaid'
    },

    paidDate: { type: Date, default: null },
    paidBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        default: null
    },

    // Payment history — each partial payment is recorded
    payments: [{
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        paidBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Shopkeeper'
        },
        note: { type: String, default: '' }
    }],

    createdAt: { type: Date, default: Date.now }
});

// Index for fast upcoming EMI queries
emiPaymentSchema.index({ shopkeeper: 1, status: 1, dueDate: 1 });
emiPaymentSchema.index({ device: 1, installmentNumber: 1 });

module.exports = mongoose.model('EmiPayment', emiPaymentSchema);


const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const EmiPayment = require('../models/EmiPayment');
const { protect } = require('../middleware/auth');


// ─────────────────────────────────────────────
// Helper: re-build EMI schedule after update
// ─────────────────────────────────────────────
const buildEmiSchedule = (device) => {
    const { _id, imei, shopkeeper, emiTenure, emiAmount, emiStartDate } = device;
    const schedule = [];
    for (let i = 0; i < emiTenure; i++) {
        const dueDate = new Date(emiStartDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        schedule.push({
            device: _id,
            imei,
            shopkeeper,
            installmentNumber: i + 1,
            dueDate,
            amount: emiAmount,
            status: 'Unpaid'
        });
    }
    return schedule;
};

// ══════════════════════════════════════════════
//  GET /api/emis/upcoming
//  All upcoming (unpaid) EMIs for the logged-in shopkeeper
//  Sorted by dueDate ASC. Query: ?days=30 (default 30 days ahead)
// ══════════════════════════════════════════════
router.get('/upcoming', protect, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const now = new Date();
        const future = new Date();
        future.setDate(future.getDate() + days);

        const emis = await EmiPayment.find({
            shopkeeper: req.user._id,
            status: { $in: ['Unpaid', 'Partial'] },
            dueDate: { $lte: future }
        })
            .populate({
                path: 'device',
                select: 'imei brand model customerName phoneNumber totalPrice profilePicture platform'
            })
            .sort({ dueDate: 1 });

        // Flatten into the shape the mobile app expects
        const data = emis.map(e => ({
            _id: e._id,
            customerName: e.device ? e.device.customerName : 'N/A',
            mobile: e.device ? e.device.phoneNumber : 'N/A',
            profilePicture: e.device ? e.device.profilePicture : null,
            imei: e.imei,
            totalLoanAmount: e.device ? e.device.totalPrice : 0,
            emiDate: e.dueDate,
            emiAmount: e.amount,
            paidAmount: e.paidAmount || 0,
            remaining: e.amount - (e.paidAmount || 0),
            installmentNumber: e.installmentNumber,
            status: e.status,
            platform: e.device ? e.device.platform : 'android'
        }));

        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  GET /api/devices/:imei/emis
//  Full EMI schedule for a single device
// ══════════════════════════════════════════════
router.get('/device/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const emis = await EmiPayment.find({ device: device._id }).sort({ installmentNumber: 1 });

        const paidTotal = emis.filter(e => e.status === 'Paid' || e.status === 'Partial').reduce((sum, e) => sum + e.paidAmount, 0);
        const unpaidTotal = emis.filter(e => e.status === 'Unpaid').reduce((sum, e) => sum + e.amount, 0)
            + emis.filter(e => e.status === 'Partial').reduce((sum, e) => sum + (e.amount - e.paidAmount), 0);

        res.json({
            success: true,
            data: {
                imei: device.imei,
                customerName: device.customerName,
                totalPrice: device.totalPrice,
                downPayment: device.downPayment,
                balance: device.balance,
                emiTenure: device.emiTenure,
                emiAmount: device.emiAmount,
                emiStartDate: device.emiStartDate,
                summary: {
                    total: emis.length,
                    paid: emis.filter(e => e.status === 'Paid').length,
                    partial: emis.filter(e => e.status === 'Partial').length,
                    unpaid: emis.filter(e => e.status === 'Unpaid').length,
                    paidTotal: parseFloat(paidTotal.toFixed(2)),
                    unpaidTotal: parseFloat(unpaidTotal.toFixed(2))
                },
                schedule: emis
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  POST /api/emis/:emiId/mark-paid
//  Mark a single EMI installment as paid (full or partial)
//  Body: { amount?: number, note?: string }
//    - If amount is omitted or >= remaining → marks fully Paid
//    - If amount < remaining → marks Partial
// ══════════════════════════════════════════════
router.post('/:emiId/mark-paid', protect, async (req, res) => {
    try {
        const emi = await EmiPayment.findById(req.params.emiId);
        if (!emi) return res.status(404).json({ success: false, message: 'EMI record not found' });

        // Ensure this EMI belongs to the shopkeeper
        if (req.user.role !== 'admin' && emi.shopkeeper.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        if (emi.status === 'Paid') {
            return res.status(400).json({ success: false, message: 'EMI is already fully paid' });
        }

        const remaining = emi.amount - emi.paidAmount;
        const paymentAmount = req.body.amount !== undefined ? parseFloat(req.body.amount) : remaining;
        const note = req.body.note || '';

        if (paymentAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0' });
        }
        if (paymentAmount > remaining) {
            return res.status(400).json({ success: false, message: `Amount exceeds remaining balance of ${remaining}` });
        }

        // Record this payment
        emi.paidAmount += paymentAmount;
        emi.payments.push({
            amount: paymentAmount,
            date: new Date(),
            paidBy: req.user._id,
            note
        });

        // Update status based on how much is now paid
        if (emi.paidAmount >= emi.amount) {
            emi.status = 'Paid';
            emi.paidDate = new Date();
            emi.paidBy = req.user._id;
        } else {
            emi.status = 'Partial';
        }

        await emi.save();

        // Update device balance (deduct the paid amount)
        await Device.findByIdAndUpdate(emi.device, {
            $inc: { balance: -paymentAmount }
        });

        res.json({
            success: true,
            message: emi.status === 'Paid' ? 'EMI fully paid' : `Partial payment recorded. Remaining: ${emi.amount - emi.paidAmount}`,
            data: emi
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  PUT /api/emis/device/:imei
//  Update EMI plan for a device — deletes unpaid installments, re-generates
//  Body: { emiTenure, emiStartDate, emiAmount, totalPrice, downPayment, balance }
// ══════════════════════════════════════════════
router.put('/device/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const { emiTenure, emiStartDate, emiAmount, totalPrice, downPayment, balance } = req.body;

        if (emiTenure !== undefined) device.emiTenure = parseInt(emiTenure);
        if (emiStartDate !== undefined) device.emiStartDate = new Date(emiStartDate);
        if (totalPrice !== undefined) device.totalPrice = totalPrice;
        if (downPayment !== undefined) device.downPayment = downPayment;
        if (balance !== undefined) device.balance = balance;

        const tenure = device.emiTenure || 1;
        const bal = device.balance || 0;
        device.emiAmount = emiAmount !== undefined
            ? emiAmount
            : (tenure > 0 ? parseFloat((bal / tenure).toFixed(5)) : 0);

        await device.save();

        // Delete all unpaid installments and recreate
        await EmiPayment.deleteMany({ device: device._id, status: 'Unpaid' });

        let newSchedule = [];
        if (tenure > 0 && device.emiAmount > 0) {
            // Find the highest installment number already paid (fully or partially)
            const lastPaid = await EmiPayment.findOne({ device: device._id, status: { $in: ['Paid', 'Partial'] } }).sort({ installmentNumber: -1 });
            const startInstallment = lastPaid ? lastPaid.installmentNumber + 1 : 1;
            const startDate = device.emiStartDate || new Date();

            for (let i = 0; i < tenure; i++) {
                const dueDate = new Date(startDate);
                dueDate.setMonth(dueDate.getMonth() + (startInstallment - 1) + i);
                newSchedule.push({
                    device: device._id,
                    imei: device.imei,
                    shopkeeper: device.shopkeeper,
                    installmentNumber: startInstallment + i,
                    dueDate,
                    amount: device.emiAmount,
                    status: 'Unpaid'
                });
            }
            await EmiPayment.insertMany(newSchedule);
        }

        res.json({ success: true, message: 'EMI plan updated successfully', data: { device, newInstallments: newSchedule.length } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  GET /api/emis/history/:imei
//  Paid EMI history for a device
// ══════════════════════════════════════════════
router.get('/history/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const history = await EmiPayment.find({ device: device._id, status: { $in: ['Paid', 'Partial'] } })
            .populate('paidBy', 'name phone')
            .sort({ paidDate: -1 });

        const totalPaid = history.reduce((sum, e) => sum + (e.paidAmount || e.amount), 0);

        res.json({
            success: true,
            data: {
                imei: device.imei,
                customerName: device.customerName,
                totalPaid: parseFloat(totalPaid.toFixed(2)),
                count: history.length,
                history
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;


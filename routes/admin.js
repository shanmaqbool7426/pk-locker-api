const express = require('express');
const router = express.Router();
const Shopkeeper = require('../models/Shopkeeper');
const Device = require('../models/Device');
const EmiPayment = require('../models/EmiPayment');
const Key = require('../models/Key');
const KeyOrder = require('../models/KeyOrder');
const { protect, adminOnly } = require('../middleware/auth');
const { allocateKeysToShopkeeper } = require('../utils/keyHelper');

// All routes require admin authentication
router.use(protect, adminOnly);

// ══════════════════════════════════════════════
//  SHOPKEEPER MANAGEMENT
// ══════════════════════════════════════════════

// GET /api/admin/shopkeepers
// List all shopkeepers with their key stats
router.get('/shopkeepers', async (req, res) => {
    try {
        const { search, isActive } = req.query;
        const query = {};

        if (search) {
            const regex = new RegExp(search, 'i');
            query.$or = [{ name: regex }, { email: regex }, { shopName: regex }, { phone: regex }];
        }
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const shopkeepers = await Shopkeeper.find(query).select('-password').sort({ createdAt: -1 });

        // Attach key stats to each shopkeeper
        const ids = shopkeepers.map(s => s._id);
        const allKeys = await Key.find({ shopkeeper: { $in: ids } });

        const data = shopkeepers.map(sk => {
            const androidK = allKeys.find(k => k.shopkeeper.toString() === sk._id.toString() && k.platform === 'android');
            const iosK = allKeys.find(k => k.shopkeeper.toString() === sk._id.toString() && k.platform === 'ios');
            return {
                ...sk.toJSON(),
                keyStats: {
                    android: androidK
                        ? { totalKeys: androidK.totalKeys, usedKeys: androidK.usedKeys, availableKeys: androidK.totalKeys - androidK.usedKeys }
                        : { totalKeys: 0, usedKeys: 0, availableKeys: 0 },
                    ios: iosK
                        ? { totalKeys: iosK.totalKeys, usedKeys: iosK.usedKeys, availableKeys: iosK.totalKeys - iosK.usedKeys }
                        : { totalKeys: 0, usedKeys: 0, availableKeys: 0 }
                }
            };
        });

        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/admin/shopkeepers
// Create a new shopkeeper account and initialise key records
router.post('/shopkeepers', async (req, res) => {
    try {
        const { name, email, password, phone, shopName, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'name, email and password are required' });
        }

        const existing = await Shopkeeper.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        const shopkeeper = new Shopkeeper({ name, email, password, phone, shopName, role: role || 'shopkeeper' });
        await shopkeeper.save();

        // Initialise key records
        await Key.insertMany([
            { shopkeeper: shopkeeper._id, platform: 'android', totalKeys: 0, usedKeys: 0 },
            { shopkeeper: shopkeeper._id, platform: 'ios', totalKeys: 0, usedKeys: 0 }
        ]);

        res.status(201).json({
            success: true,
            message: 'Shopkeeper created successfully',
            data: { id: shopkeeper._id, name: shopkeeper.name, email: shopkeeper.email, role: shopkeeper.role }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PATCH /api/admin/shopkeepers/:id
// Update shopkeeper details (not password — use change-password route)
router.patch('/shopkeepers/:id', async (req, res) => {
    try {
        const allowed = ['name', 'phone', 'shopName', 'role', 'isActive'];
        const updates = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        // Allow admin to reset password too
        if (req.body.password) {
            const shopkeeper = await Shopkeeper.findById(req.params.id);
            if (!shopkeeper) return res.status(404).json({ success: false, message: 'Shopkeeper not found' });
            shopkeeper.password = req.body.password;
            Object.assign(shopkeeper, updates);
            await shopkeeper.save();
            return res.json({ success: true, message: 'Shopkeeper updated successfully' });
        }

        const shopkeeper = await Shopkeeper.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
        if (!shopkeeper) return res.status(404).json({ success: false, message: 'Shopkeeper not found' });

        res.json({ success: true, message: 'Shopkeeper updated successfully', data: shopkeeper });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/admin/shopkeepers/:id
// Soft-delete: sets isActive = false
router.delete('/shopkeepers/:id', async (req, res) => {
    try {
        const shopkeeper = await Shopkeeper.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        ).select('-password');

        if (!shopkeeper) return res.status(404).json({ success: false, message: 'Shopkeeper not found' });

        res.json({ success: true, message: 'Shopkeeper deactivated', data: shopkeeper });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  KEY ALLOCATION
// ══════════════════════════════════════════════

// POST /api/admin/keys/allocate
// Body: { shopkeeperId, platform: 'android'|'ios', keys: number }
// Adds `keys` to the shopkeeper's total key balance
router.post('/keys/allocate', async (req, res) => {
    try {
        const { shopkeeperId, platform, keys } = req.body;

        if (!shopkeeperId || !platform || !keys) {
            return res.status(400).json({ success: false, message: 'shopkeeperId, platform and keys are required' });
        }
        if (!['android', 'ios'].includes(platform)) {
            return res.status(400).json({ success: false, message: 'platform must be android or ios' });
        }
        if (typeof keys !== 'number' || keys < 1) {
            return res.status(400).json({ success: false, message: 'keys must be a positive number' });
        }

        const shopkeeper = await Shopkeeper.findById(shopkeeperId);
        if (!shopkeeper) return res.status(404).json({ success: false, message: 'Shopkeeper not found' });

        const keyRecord = await Key.findOneAndUpdate(
            { shopkeeper: shopkeeperId, platform },
            { $inc: { totalKeys: keys }, $set: { updatedAt: new Date() } },
            { new: true, upsert: true }
        );

        res.json({
            success: true,
            message: `${keys} ${platform} keys allocated to ${shopkeeper.name}`,
            data: {
                shopkeeperName: shopkeeper.name,
                platform,
                totalKeys: keyRecord.totalKeys,
                usedKeys: keyRecord.usedKeys,
                availableKeys: keyRecord.totalKeys - keyRecord.usedKeys
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/admin/keys
// List all key records with shopkeeper names
router.get('/keys', async (req, res) => {
    try {
        const keys = await Key.find({}).populate('shopkeeper', 'name email shopName');
        const data = keys.map(k => ({
            shopkeeper: k.shopkeeper,
            platform: k.platform,
            totalKeys: k.totalKeys,
            usedKeys: k.usedKeys,
            availableKeys: k.totalKeys - k.usedKeys,
            updatedAt: k.updatedAt
        }));
        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  ALL DEVICES (admin view)
// ══════════════════════════════════════════════

// GET /api/admin/devices
// Query: ?shopkeeperId=&platform=&status=Locked|Unlocked&isDeregistered=true|false&search=
router.get('/devices', async (req, res) => {
    try {
        const { shopkeeperId, platform, status, isDeregistered, search } = req.query;
        const query = {};

        if (shopkeeperId) query.shopkeeper = shopkeeperId;
        if (platform) query.platform = platform;
        if (status) query.status = status;
        if (isDeregistered !== undefined) query.isDeregistered = isDeregistered === 'true';

        if (search) {
            const regex = new RegExp(search, 'i');
            query.$or = [
                { customerName: regex },
                { phoneNumber: regex },
                { imei: regex },
                { cnic: regex }
            ];
        }

        const devices = await Device.find(query)
            .populate('shopkeeper', 'name email shopName')
            .sort({ registeredAt: -1 });

        res.json({ success: true, count: devices.length, data: devices });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  GLOBAL STATS
// ══════════════════════════════════════════════

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
    try {
        const [
            totalShopkeepers,
            activeShopkeepers,
            totalDevices,
            activeDevices,
            lockedDevices,
            deregisteredDevices,
            androidDevices,
            iosDevices,
            unpaidEmis,
            paidEmis
        ] = await Promise.all([
            Shopkeeper.countDocuments({ role: 'shopkeeper' }),
            Shopkeeper.countDocuments({ role: 'shopkeeper', isActive: true }),
            Device.countDocuments(),
            Device.countDocuments({ isDeregistered: false }),
            Device.countDocuments({ isDeregistered: false, status: 'Locked' }),
            Device.countDocuments({ isDeregistered: true }),
            Device.countDocuments({ platform: 'android', isDeregistered: false }),
            Device.countDocuments({ platform: 'ios', isDeregistered: false }),
            EmiPayment.countDocuments({ status: 'Unpaid' }),
            EmiPayment.countDocuments({ status: 'Paid' })
        ]);

        // Key totals across all shopkeepers
        const allKeys = await Key.find({});
        const androidKeyTotal = allKeys.filter(k => k.platform === 'android').reduce((s, k) => s + k.totalKeys, 0);
        const androidKeyUsed = allKeys.filter(k => k.platform === 'android').reduce((s, k) => s + k.usedKeys, 0);
        const iosKeyTotal = allKeys.filter(k => k.platform === 'ios').reduce((s, k) => s + k.totalKeys, 0);
        const iosKeyUsed = allKeys.filter(k => k.platform === 'ios').reduce((s, k) => s + k.usedKeys, 0);

        // Total revenue collected (paid EMIs)
        const paidRevenue = await EmiPayment.aggregate([
            { $match: { status: 'Paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalRevenue = paidRevenue.length > 0 ? paidRevenue[0].total : 0;

        res.json({
            success: true,
            data: {
                shopkeepers: { total: totalShopkeepers, active: activeShopkeepers },
                devices: {
                    total: totalDevices,
                    active: activeDevices,
                    locked: lockedDevices,
                    deregistered: deregisteredDevices,
                    android: androidDevices,
                    ios: iosDevices
                },
                emis: { unpaid: unpaidEmis, paid: paidEmis },
                keys: {
                    android: { total: androidKeyTotal, used: androidKeyUsed, available: androidKeyTotal - androidKeyUsed },
                    ios: { total: iosKeyTotal, used: iosKeyUsed, available: iosKeyTotal - iosKeyUsed }
                },
                revenue: { totalCollected: parseFloat(totalRevenue.toFixed(2)) }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  MANUAL TRIGGERS
// ══════════════════════════════════════════════

// POST /api/admin/trigger-emi-check
// Manually triggers the Daily EMI compliance check (usually runs via node-cron at midnight)
router.post('/trigger-emi-check', async (req, res) => {
    try {
        const { checkOverdueEmis } = require('../cron/emiEnforcer');
        
        // Run asynchronously, don't wait for completion if it takes long, or await it.
        // It's safer to await it for a controlled response.
        await checkOverdueEmis();
        
        res.json({ success: true, message: 'EMI compliance check executed successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error while triggering EMI check' });
    }
});

// POST /api/admin/trigger-emi-reminders
// Manually triggers the EMI Reminders Check (usually runs via node-cron at 9:00 AM)
router.post('/trigger-emi-reminders', async (req, res) => {
    try {
        const { checkUpcomingReminders } = require('../cron/emiReminders');
        
        await checkUpcomingReminders();
        
        res.json({ success: true, message: 'EMI Reminders check executed successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error while triggering EMI reminders' });
    }
});
 
// ══════════════════════════════════════════════
//  KEY ORDER MANAGEMENT (Manual Approval)
// ══════════════════════════════════════════════
 
// GET /api/admin/key-orders
// List all key orders (can filter by status)
router.get('/key-orders', async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const orders = await KeyOrder.find(query)
            .populate('shopkeeper', 'name email shopName phone')
            .sort({ createdAt: -1 });
        res.json({ success: true, count: orders.length, data: orders });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
 
// POST /api/admin/key-orders/:id/approve
// Approves a manual order (e.g. after WhatsApp payment verification)
router.post('/key-orders/:id/approve', async (req, res) => {
    try {
        const order = await KeyOrder.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (order.status !== 'Pending') return res.status(400).json({ success: false, message: 'Order is already ' + order.status });
 
        order.status = 'Approved';
        order.updatedAt = new Date();
        await order.save();
 
        // Allocate keys to shopkeeper
        await allocateKeysToShopkeeper(order.shopkeeper, order.numKeys, order.platform);
 
        res.json({ success: true, message: 'Order approved and keys allocated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
 
// POST /api/admin/key-orders/:id/reject
router.post('/key-orders/:id/reject', async (req, res) => {
    try {
        const { notes } = req.body;
        const order = await KeyOrder.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
 
        order.status = 'Rejected';
        if (notes) order.adminNotes = notes;
        order.updatedAt = new Date();
        await order.save();
 
        res.json({ success: true, message: 'Order rejected' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;


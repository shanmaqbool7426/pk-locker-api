const express = require('express');
const router = express.Router();
const Shopkeeper = require('../models/Shopkeeper');
const Key = require('../models/Key');
const { protect, dealerOnly } = require('../middleware/auth');

// All routes here require an authenticated dealer.
// Dealers get NO device/EMI/customer data access — only creating and viewing
// shopkeeper accounts they own. Key funding happens separately: the dealer and
// shopkeeper agree on payment themselves, the dealer pays the admin, and the
// admin allocates keys directly into that shopkeeper's account
// (see POST /api/admin/keys/allocate) — keys never sit in the dealer's own balance.
router.use(protect, dealerOnly);

// GET /api/dealer/shopkeepers
// List only the shopkeepers this dealer created, with their key stats
router.get('/shopkeepers', async (req, res) => {
    try {
        // No need to populate/return `dealer` here — every row belongs to this
        // same dealer (req.user), so excluding it avoids a raw ObjectId string
        // showing up where the Android client expects a populated object (as
        // it does on the admin-facing list).
        const shopkeepers = await Shopkeeper.find({ dealer: req.user._id }).select('-password -dealer').sort({ createdAt: -1 });

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

// POST /api/dealer/shopkeepers
// Creates a new shopkeeper account owned by this dealer
router.post('/shopkeepers', async (req, res) => {
    try {
        const { name, password, phone, shopName } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ success: false, message: 'name, phone and password are required' });
        }

        const existing = await Shopkeeper.findOne({ phone: phone.trim() });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Phone already registered' });
        }

        // role is always 'shopkeeper' here — a dealer cannot create another dealer or admin
        const shopkeeper = new Shopkeeper({ name, password, phone, shopName, role: 'shopkeeper', dealer: req.user._id });
        await shopkeeper.save();

        // Starts at 0 keys — admin allocates keys directly once the dealer pays them
        await Key.insertMany([
            { shopkeeper: shopkeeper._id, platform: 'android', totalKeys: 0, usedKeys: 0 },
            { shopkeeper: shopkeeper._id, platform: 'ios', totalKeys: 0, usedKeys: 0 }
        ]);

        res.status(201).json({
            success: true,
            message: 'Shopkeeper created successfully',
            data: { id: shopkeeper._id, name: shopkeeper.name, phone: shopkeeper.phone, shopName: shopkeeper.shopName }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Shopkeeper = require('../models/Shopkeeper');
const Key = require('../models/Key');
const { protect, adminOnly } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'pklocker_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Helper: generate JWT
const generateToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// ─────────────────────────────────────────────
// POST /api/auth/login
// Body: { phone, password }
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ success: false, message: 'Phone and password are required' });
        }

        const shopkeeper = await Shopkeeper.findOne({ phone: phone.trim() });
        if (!shopkeeper) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!shopkeeper.isActive) {
            return res.status(403).json({ success: false, message: 'Account is deactivated. Contact admin.' });
        }

        const isMatch = await shopkeeper.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = generateToken(shopkeeper._id);

        res.json({
            success: true,
            message: 'Login successful',
            token,
            shopkeeper: {
                id: shopkeeper._id,
                name: shopkeeper.name,
                email: shopkeeper.email,
                phone: shopkeeper.phone,
                shopName: shopkeeper.shopName,
                role: shopkeeper.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/auth/register
// Admin only — creates a new shopkeeper account and initialises key records
// Body: { name, email, password, phone, shopName, role?, referredByPhone? }
// ─────────────────────────────────────────────
router.post('/register', protect, adminOnly, async (req, res) => {
    try {
        const { name, email, password, phone, shopName, role, referredByPhone } = req.body;

        if (!name || !phone || !password || !email) {
            return res.status(400).json({ success: false, message: 'name, email, phone and password are required' });
        }

        const existingEmail = await Shopkeeper.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        
        const existingPhone = await Shopkeeper.findOne({ phone: phone.trim() });
        if (existingPhone) {
            return res.status(400).json({ success: false, message: 'Phone already registered' });
        }

        const shopkeeper = new Shopkeeper({
            name,
            email,
            password,
            phone,
            shopName,
            role: role || 'shopkeeper',
            referredByPhone: referredByPhone || null
        });
        await shopkeeper.save();

        // Initialise key records for both platforms
        // NEW ACCOUNT GETS 5 FREE KEYS
        await Key.insertMany([
            { shopkeeper: shopkeeper._id, platform: 'android', totalKeys: 5, usedKeys: 0 },
            { shopkeeper: shopkeeper._id, platform: 'ios', totalKeys: 0, usedKeys: 0 }
        ]);

        res.status(201).json({
            success: true,
            message: 'Shopkeeper registered successfully with 5 Free Keys!',
            shopkeeper: {
                id: shopkeeper._id,
                name: shopkeeper.name,
                email: shopkeeper.email,
                phone: shopkeeper.phone,
                shopName: shopkeeper.shopName,
                role: shopkeeper.role,
                referredByPhone: shopkeeper.referredByPhone
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/auth/me
// Returns the currently authenticated shopkeeper's profile + key stats
// ─────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
    try {
        const shopkeeper = req.user;

        const keys = await Key.find({ shopkeeper: shopkeeper._id });

        const keyStats = {};
        keys.forEach(k => {
            keyStats[k.platform] = {
                totalKeys: k.totalKeys,
                usedKeys: k.usedKeys,
                availableKeys: k.totalKeys - k.usedKeys
            };
        });

        // Defaults if no key records yet
        if (!keyStats.android) keyStats.android = { totalKeys: 0, usedKeys: 0, availableKeys: 0 };
        if (!keyStats.ios) keyStats.ios = { totalKeys: 0, usedKeys: 0, availableKeys: 0 };

        res.json({
            success: true,
            shopkeeper: {
                id: shopkeeper._id,
                name: shopkeeper.name,
                email: shopkeeper.email,
                phone: shopkeeper.phone,
                shopName: shopkeeper.shopName,
                role: shopkeeper.role,
                isActive: shopkeeper.isActive,
                createdAt: shopkeeper.createdAt
            },
            keyStats
        });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// PATCH /api/auth/change-password
// Body: { currentPassword, newPassword }
// ─────────────────────────────────────────────
router.patch('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required' });
        }

        const shopkeeper = await Shopkeeper.findById(req.user._id);
        const isMatch = await shopkeeper.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        shopkeeper.password = newPassword;
        await shopkeeper.save();

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// PATCH /api/auth/update-fcm-token
// Body: { fcmToken }
// ─────────────────────────────────────────────
router.patch('/update-fcm-token', protect, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) {
            return res.status(400).json({ success: false, message: 'fcmToken is required' });
        }

        const shopkeeper = await Shopkeeper.findById(req.user._id);
        shopkeeper.fcmToken = fcmToken;
        await shopkeeper.save();

        console.log(`[FCM] Shopkeeper (${shopkeeper.email}) token updated`);
        res.json({ success: true, message: 'Shopkeeper FCM token updated' });
    } catch (err) {
        console.error('Update FCM error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const GlobalConfig = require('../models/GlobalConfig');
const Shopkeeper = require('../models/Shopkeeper');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/config/update
// Public check for app updates
router.get('/update', async (req, res) => {
    try {
        let config = await GlobalConfig.findOne({ key: 'app_update' });

        if (!config) {
            // Default config if not exists in DB
            return res.json({
                success: true,
                data: {
                    versionCode: 3,
                    versionName: "1.2",
                    updateUrl: "https://pk-locker-api.vercel.app/apk/update.apk",
                    updateTitle: "Update Available",
                    updateMessage: "Please update to the latest version of PK Locker.",
                    isForceUpdate: false,
                    isUpdateEnabled: false
                }
            });
        }

        res.json({ success: true, data: config.value });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/config/update
// Admin only: Update the app update configuration
router.post('/update', protect, adminOnly, async (req, res) => {
    try {
        const {
            versionCode,
            versionName,
            updateUrl,
            updateTitle,
            updateMessage,
            isForceUpdate,
            isUpdateEnabled
        } = req.body;

        const updateData = {
            versionCode: parseInt(versionCode),
            versionName,
            updateUrl,
            updateTitle,
            updateMessage,
            isForceUpdate: isForceUpdate === true || isForceUpdate === 'true',
            isUpdateEnabled: isUpdateEnabled === true || isUpdateEnabled === 'true'
        };

        const previous = await GlobalConfig.findOne({ key: 'app_update' });
        const prevVersionCode = previous?.value?.versionCode ?? 0;

        const config = await GlobalConfig.findOneAndUpdate(
            { key: 'app_update' },
            { value: updateData, updatedAt: new Date() },
            { upsert: true, new: true }
        );

        // Per-user update state: a HIGHER versionCode means the admin PUSHED a
        // new update, so arm the popup for EVERY user (updatePending -> true).
        // Each user flips their own state back to false via
        // POST /api/config/update-consumed once the popup is served to them.
        // Editing other fields (message / force flags / URL) does NOT re-arm.
        if (updateData.versionCode > prevVersionCode) {
            const armed = await Shopkeeper.updateMany({}, { $set: { updatePending: true } });
            console.log(`[UPDATE PUSH] v${prevVersionCode} -> v${updateData.versionCode}: updatePending armed for ${armed.modifiedCount} user(s)`);
        }

        res.json({ success: true, message: 'App update configuration updated', data: config.value });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/config/update-consumed
// Any logged-in user: the update popup has just been served on their device,
// so flip THEIR OWN per-user update state back to false.
router.post('/update-consumed', protect, async (req, res) => {
    try {
        await Shopkeeper.findByIdAndUpdate(req.user._id, { $set: { updatePending: false } });
        res.json({ success: true, message: 'Update state cleared for this user' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;

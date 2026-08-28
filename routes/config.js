const express = require('express');
const router = express.Router();
const GlobalConfig = require('../models/GlobalConfig');
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

        const config = await GlobalConfig.findOneAndUpdate(
            { key: 'app_update' },
            { value: updateData, updatedAt: new Date() },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: 'App update configuration updated', data: config.value });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;

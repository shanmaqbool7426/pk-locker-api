const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const admin = require('firebase-admin');
const Device = require('../models/Device');
const EmiPayment = require('../models/EmiPayment');
const Key = require('../models/Key');
const { protect, adminOnly } = require('../middleware/auth');

// ─────────────────────────────────────────────
// Helper: send FCM message (silent data push)
// ─────────────────────────────────────────────
const sendFCM = async (fcmToken, data) => {
    if (!fcmToken) {
        console.warn('Cannot send FCM: No token found for device.');
        return;
    }
    try {
        console.log(`[FCM] Sending command: ${data.command} to target: ${data.target} (State: ${data.state})`);
        console.log(`[FCM] Using Token: ${fcmToken.substring(0, 10)}...${fcmToken.substring(fcmToken.length - 10)}`);
        const response = await admin.messaging().send({
            data,
            token: fcmToken,
            android: {
                priority: 'high'
            }
        });
        console.log(`[FCM] Success: Message sent (ID: ${response})`);
    } catch (err) {
        console.error('[FCM] Error:', err.message);
    }
};

// ─────────────────────────────────────────────
// Helper: generate EMI schedule for a device
// Returns array of EmiPayment docs (not yet saved)
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

// ─────────────────────────────────────────────
// Helper: generate deterministic SMS codes from IMEI
// ─────────────────────────────────────────────
const generateSmsCodes = (imei) => {
    const lockCode = crypto.createHash('sha256').update(`LOCK_${imei}`).digest('hex');
    const unlockCode = crypto.createHash('sha256').update(`UNLOCK_${imei}`).digest('hex');
    return { lockCode, unlockCode };
};

// ══════════════════════════════════════════════
//  DEVICE REGISTRATION
// ══════════════════════════════════════════════

// POST /api/devices/register
// Registers device, consumes 1 key, generates EMI schedule
router.post('/register', protect, async (req, res) => {
    try {
        const {
            imei, imei2, brand, model, androidVersion, platform,
            customerName, cnic, phoneNumber, profilePicture,
            productName, totalPrice, downPayment, balance,
            emiTenure, emiStartDate, emiAmount,
            guarantor
        } = req.body;

        if (!imei || !customerName || !cnic || !phoneNumber) {
            return res.status(400).json({ success: false, message: 'imei, customerName, cnic and phoneNumber are required' });
        }

        // Check duplicate
        const existing = await Device.findOne({ imei });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Device with this IMEI is already registered' });
        }

        const devicePlatform = platform || 'android';

        // Check key availability
        let keyRecord = await Key.findOne({ shopkeeper: req.user._id, platform: devicePlatform });
        if (!keyRecord) {
            // Auto-create key record with 0 balance so admin can see it
            keyRecord = await Key.create({ shopkeeper: req.user._id, platform: devicePlatform, totalKeys: 0, usedKeys: 0 });
        }
        if (keyRecord.availableKeys <= 0) {
            return res.status(403).json({
                success: false,
                message: `No available ${devicePlatform} keys. Please contact admin to allocate more keys.`
            });
        }

        // Generate SMS codes
        const smsCodes = generateSmsCodes(imei);

        // Parse emiTenure as integer
        const tenure = parseInt(emiTenure) || 1;
        const startDate = emiStartDate ? new Date(emiStartDate) : new Date();
        const emiAmountCalc = emiAmount || (balance && tenure ? parseFloat((balance / tenure).toFixed(5)) : 0);


        const device = new Device({
            imei, imei2, brand, model, androidVersion,
            platform: devicePlatform,
            customerName, cnic, phoneNumber, profilePicture,
            productName, totalPrice, downPayment, balance,
            emiTenure: tenure,
            emiStartDate: startDate,
            emiAmount: emiAmountCalc,
            guarantor,
            smsCodes,
            status: 'Unlocked',
            shopkeeper: req.user._id
        });

        await device.save();

        // Generate and save EMI schedule
        if (tenure > 0 && emiAmountCalc > 0) {
            const schedule = buildEmiSchedule(device);
            await EmiPayment.insertMany(schedule);
        }

        // Consume 1 key
        keyRecord.usedKeys += 1;
        keyRecord.updatedAt = new Date();
        await keyRecord.save();

        res.status(201).json({
            success: true,
            message: 'Device registered successfully',
            device: {
                id: device._id,
                imei: device.imei,
                customerName: device.customerName,
                platform: device.platform,
                status: device.status,
                emiTenure: device.emiTenure,
                emiAmount: device.emiAmount,
                smsCodes: device.smsCodes
            }
        });
    } catch (err) {
        console.error('Register device error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  DEVICE LISTS
// ══════════════════════════════════════════════

// GET /api/devices
// Active (non-deregistered) customers for current shopkeeper
// Query: ?search=name_or_mobile&platform=android|ios
router.get('/', protect, async (req, res) => {
    try {
        const { search, platform } = req.query;
        const query = { shopkeeper: req.user._id, isDeregistered: false };

        if (platform) query.platform = platform;

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
            .select('imei imei2 brand model platform customerName phoneNumber cnic profilePicture status balance emiTenure emiAmount emiStartDate registeredAt smsCodes controls appRestrictions')
            .sort({ registeredAt: -1 });

        res.json({ success: true, count: devices.length, data: devices });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/devices/deregistered
// Deregistered customers for current shopkeeper
router.get('/deregistered', protect, async (req, res) => {
    try {
        const { search } = req.query;
        const query = { shopkeeper: req.user._id, isDeregistered: true };

        if (search) {
            const regex = new RegExp(search, 'i');
            query.$or = [
                { customerName: regex },
                { phoneNumber: regex },
                { imei: regex }
            ];
        }

        const devices = await Device.find(query)
            .select('imei imei2 brand model platform customerName phoneNumber cnic profilePicture status deregisteredAt registeredAt smsCodes controls appRestrictions')
            .sort({ deregisteredAt: -1 });

        res.json({ success: true, count: devices.length, data: devices });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/devices/stats
// Dashboard stats for current shopkeeper (key counts)
router.get('/stats', protect, async (req, res) => {
    try {
        const shopkeeperId = req.user._id;

        // Key stats
        const [androidKeys, iosKeys] = await Promise.all([
            Key.findOne({ shopkeeper: shopkeeperId, platform: 'android' }),
            Key.findOne({ shopkeeper: shopkeeperId, platform: 'ios' })
        ]);

        const buildKeyStat = (k) => ({
            totalKeys: k ? k.totalKeys : 0,
            usedKeys: k ? k.usedKeys : 0,
            availableKeys: k ? (k.totalKeys - k.usedKeys) : 0
        });

        // Device counts
        const [totalDevices, lockedDevices, deregisteredDevices] = await Promise.all([
            Device.countDocuments({ shopkeeper: shopkeeperId, isDeregistered: false }),
            Device.countDocuments({ shopkeeper: shopkeeperId, isDeregistered: false, status: 'Locked' }),
            Device.countDocuments({ shopkeeper: shopkeeperId, isDeregistered: true })
        ]);

        res.json({
            success: true,
            data: {
                android: buildKeyStat(androidKeys),
                ios: buildKeyStat(iosKeys),
                devices: { total: totalDevices, locked: lockedDevices, deregistered: deregisteredDevices }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  SINGLE DEVICE
// ══════════════════════════════════════════════

// GET /api/devices/:imei
// Full device details (Action + Device Detail + Customer + EMI Detail tabs)
router.get('/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        // Non-admins can only see their own devices
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).populate('shopkeeper', 'name email phone shopName');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        // Fetch EMI summary
        const emis = await EmiPayment.find({ device: device._id }).sort({ installmentNumber: 1 });
        const unpaidCount = emis.filter(e => e.status === 'Unpaid').length;
        const paidCount = emis.filter(e => e.status === 'Paid').length;

        res.json({
            success: true,
            data: {
                device,
                emiSummary: {
                    total: emis.length,
                    paid: paidCount,
                    unpaid: unpaidCount,
                    schedule: emis
                }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/devices/:imei
// Update customer / device / EMI details
// If EMI-related fields change, old unpaid schedule is deleted and re-generated
router.put('/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const emiFieldsChanged = ['balance', 'emiTenure', 'emiStartDate', 'emiAmount'].some(
            f => req.body[f] !== undefined && req.body[f] != device[f]
        );

        const allowedFields = [
            'brand', 'model', 'androidVersion', 'imei2', 'platform',
            'customerName', 'cnic', 'phoneNumber', 'profilePicture',
            'productName', 'totalPrice', 'downPayment', 'balance',
            'emiTenure', 'emiStartDate', 'emiAmount', 'guarantor'
        ];
        allowedFields.forEach(f => {
            if (req.body[f] !== undefined) device[f] = req.body[f];
        });

        // Re-generate EMI schedule if EMI fields changed
        if (emiFieldsChanged) {
            await EmiPayment.deleteMany({ device: device._id, status: 'Unpaid' });
            const tenure = parseInt(device.emiTenure) || 1;
            const emiAmountCalc = device.emiAmount || (device.balance && tenure ? parseFloat((device.balance / tenure).toFixed(5)) : 0);
            device.emiTenure = tenure;
            device.emiAmount = emiAmountCalc;
            if (tenure > 0 && emiAmountCalc > 0) {
                const schedule = buildEmiSchedule(device);
                await EmiPayment.insertMany(schedule);
            }
        }

        await device.save();
        res.json({ success: true, message: 'Device updated successfully', data: device });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  LOCK / UNLOCK / DEREGISTER
// ══════════════════════════════════════════════

// POST /api/devices/:imei/lock
router.post('/:imei/lock', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        console.log(`[Lock Route] Locking IMEI: ${req.params.imei}`);
        const shortToken = device.fcmToken ? `${device.fcmToken.substring(0, 10)}...` : "NULL_TOKEN";
        console.log(`[Lock Route] Found Token in DB: ${shortToken}`);

        device.status = 'Locked';
        await device.save();

        await sendFCM(device.fcmToken, {
            type: 'CONTROL',
            command: 'lock',
            target: 'device',
            state: 'true'
        });

        res.json({ success: true, message: 'Device locked successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/:imei/unlock
router.post('/:imei/unlock', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        console.log(`[Unlock Route] Unlocking IMEI: ${req.params.imei}`);
        const shortToken = device.fcmToken ? `${device.fcmToken.substring(0, 10)}...` : "NULL_TOKEN";
        console.log(`[Unlock Route] Found Token in DB: ${shortToken}`);

        device.status = 'Unlocked';
        await device.save();

        await sendFCM(device.fcmToken, {
            type: 'CONTROL',
            command: 'state_change',
            target: 'device',
            state: 'false'
        });

        res.json({ success: true, message: 'Device unlocked successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/:imei/deregister
// Soft-deregisters the device (marks isDeregistered = true, releases the key)
router.post('/:imei/deregister', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        if (device.isDeregistered) {
            return res.status(400).json({ success: false, message: 'Device is already deregistered' });
        }

        console.log(`[Deregister Route] Deregistering IMEI: ${req.params.imei}`);
        device.isDeregistered = true;
        device.deregisteredAt = new Date();
        device.status = 'Unlocked';
        await device.save();

        await sendFCM(device.fcmToken, {
            type: 'CONTROL',
            command: 'deregister',
            target: 'device',
            state: 'true'
        });

        // Release the key back
        const keyRecord = await Key.findOne({ shopkeeper: device.shopkeeper, platform: device.platform });
        if (keyRecord && keyRecord.usedKeys > 0) {
            keyRecord.usedKeys -= 1;
            keyRecord.updatedAt = new Date();
            await keyRecord.save();
        }

        res.json({ success: true, message: 'Device deregistered successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  CONTROLS
// ══════════════════════════════════════════════


// POST /api/devices/:imei/controls
// Body: { action: "usbLock"|"cameraDisabled"|"whatsapp"|..., state: true|false }
router.post('/:imei/controls', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const { action, state } = req.body;
        if (action === undefined || state === undefined) {
            return res.status(400).json({ success: false, message: 'action and state are required' });
        }

        let updated = false;
        let commandType = 'state_change';
        let targetName = action;

        console.log(`[Control Request] Action: ${action}, State: ${state}, IMEI: ${req.params.imei}`);

        // 1. Map Hardware Controls
        if (device.controls[action] !== undefined) {
            device.controls[action] = state;
            updated = true;
            commandType = 'hardware_block';

            // Precise target mapping for Android logic
            if (action === 'usbLock') targetName = 'usb';
            else if (action === 'cameraDisabled') targetName = 'camera';
            else if (action === 'settingsBlocked') targetName = 'settings';
            else if (action === 'autoLock') targetName = 'auto_lock';
            else if (action === 'warningAudio') targetName = 'alarm';
            else if (action === 'installBlocked') targetName = 'install';
            else if (action === 'uninstallBlocked') targetName = 'uninstall';
            else if (action === 'outgoingCallsBlocked') targetName = 'calls';
            else if (action === 'softResetBlocked') targetName = 'reset';
            else if (action === 'softBootBlocked') targetName = 'boot';
            else if (action === 'warningWallpaper') {
                targetName = 'wallpaper';
                commandType = 'config_change';
            }
        }
        // 2. Map App Restrictions
        else if (device.appRestrictions[action] !== undefined) {
            device.appRestrictions[action] = state;
            updated = true;
            commandType = 'app_block';
            targetName = action;
        }
        // 3. Main Lock/Unlock Status
        else if (action === 'lock' || action === 'unlock' || action === 'LOCK_STATUS') {
            device.status = (action === 'lock' || (state === true || state === 'true')) ? 'Locked' : 'Unlocked';
            updated = true;
            commandType = 'lock';
            targetName = 'device';
        }

        if (!updated) {
            console.warn(`[Control Error] Unknown action: ${action}`);
            return res.status(400).json({ success: false, message: `Unknown control action: ${action}` });
        }

        await device.save();

        // Send Structured FCM (Matching new Android Logic)
        await sendFCM(device.fcmToken, {
            type: 'CONTROL',
            command: commandType,
            target: targetName,
            state: state.toString()
        });

        res.json({ success: true, message: `Control "${action}" set to ${state}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  UNLOCK ALL CONTROLS
// ══════════════════════════════════════════════

// POST /api/devices/:imei/unlock-all
// Resets all controls + appRestrictions to false and sends FCM unlock_all command
router.post('/:imei/unlock-all', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query);
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        console.log(`[Unlock All] Resetting all controls for IMEI: ${req.params.imei}`);

        // Reset ALL hardware controls to false
        device.controls.usbLock = false;
        device.controls.cameraDisabled = false;
        device.controls.installBlocked = false;
        device.controls.uninstallBlocked = false;
        device.controls.settingsBlocked = false;
        device.controls.debuggingBlocked = false;
        device.controls.outgoingCallsBlocked = false;
        device.controls.softResetBlocked = false;
        device.controls.softBootBlocked = false;
        device.controls.autoLock = false;
        device.controls.warningAudio = false;
        device.controls.warningWallpaper = null;

        // Reset ALL app restrictions to false
        device.appRestrictions.whatsapp = false;
        device.appRestrictions.facebook = false;
        device.appRestrictions.instagram = false;
        device.appRestrictions.youtube = false;
        device.appRestrictions.chrome = false;
        device.appRestrictions.telegram = false;
        device.appRestrictions.hotstar = false;

        await device.save();

        // Single FCM command — Android will clear everything
        await sendFCM(device.fcmToken, {
            type: 'CONTROL',
            command: 'unlock_all',
            target: 'device',
            state: 'true'
        });

        res.json({ success: true, message: 'All controls unlocked successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  LOCATION & FCM TOKEN (called by device app)
// ══════════════════════════════════════════════

// POST /api/devices/:imei/location
router.post('/:imei/location', async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const device = await Device.findOneAndUpdate(
            { imei: req.params.imei },
            { location: { lat, lng, updatedAt: new Date() } },
            { new: true }
        );
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
        res.json({ success: true, message: 'Location updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/update-token
router.post('/update-token', async (req, res) => {
    try {
        const { imei, fcmToken } = req.body;
        if (!imei || !fcmToken) {
            return res.status(400).json({ success: false, message: 'imei and fcmToken are required' });
        }
        const device = await Device.findOneAndUpdate({ imei }, { fcmToken }, { new: true });
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
        res.json({ success: true, message: 'FCM token updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ══════════════════════════════════════════════
//  STATUS & SMS CODES
// ══════════════════════════════════════════════

// GET /api/devices/:imei/status
router.get('/:imei/status', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).select('imei status isDeregistered customerName');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        res.json({ success: true, data: { imei: device.imei, status: device.status, isDeregistered: device.isDeregistered, customerName: device.customerName } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/devices/:imei/sms-codes
// Returns the offline SMS lock/unlock codes for this device
router.get('/:imei/sms-codes', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).select('imei smsCodes customerName');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        res.json({
            success: true,
            data: {
                imei: device.imei,
                customerName: device.customerName,
                lockCode: device.smsCodes.lockCode,
                unlockCode: device.smsCodes.unlockCode
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/devices/:imei/location
// Get last known location of a device
router.get('/:imei/location', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).select('imei location customerName');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        if (!device.location || !device.location.lat) {
            return res.json({ success: true, message: 'No location data available', data: null });
        }

        res.json({ success: true, data: { imei: device.imei, customerName: device.customerName, location: device.location } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;

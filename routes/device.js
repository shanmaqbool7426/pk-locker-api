const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const admin = require('firebase-admin');
const Device = require('../models/Device');
const EmiPayment = require('../models/EmiPayment');
const Key = require('../models/Key');
const Shopkeeper = require('../models/Shopkeeper');
const { protect, adminOnly } = require('../middleware/auth');
const { uploadImage } = require('../utils/imagekit');

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
                priority: 'high',
                ttl: 3600000 // 1 hour TTL: ensures delivery even if device is momentarily offline
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
            customerName, cnic, phoneNumber, profilePicture, cnicProofImage,
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

        const tenure = parseInt(emiTenure) || 1;
        const startDate = emiStartDate ? new Date(emiStartDate) : new Date();
        const emiAmountCalc = emiAmount || (balance && tenure ? parseFloat((balance / tenure).toFixed(5)) : 0);

        // --- Handle Image Uploads via ImageKit ---
        let profileUrl = profilePicture;
        let cnicUrl = cnicProofImage;
        let guarantorCnicUrl = guarantor ? guarantor.cnicProofImage : null;

        if (profilePicture && profilePicture.length > 500) {
            profileUrl = await uploadImage(profilePicture, `profile_${imei}`, 'profiles');
        }
        if (cnicProofImage && cnicProofImage.length > 500) {
            cnicUrl = await uploadImage(cnicProofImage, `cnic_${imei}`, 'cnic_proofs');
        }
        if (guarantor && guarantor.cnicProofImage && guarantor.cnicProofImage.length > 500) {
            guarantorCnicUrl = await uploadImage(guarantor.cnicProofImage, `guarantor_${imei}`, 'guarantor_proofs');
        }


        const device = new Device({
            imei, imei2, brand, model, androidVersion,
            platform: devicePlatform,
            customerName, cnic, phoneNumber,
            profilePicture: profileUrl,
            cnicProofImage: cnicUrl,
            productName, totalPrice, downPayment, balance,
            emiTenure: tenure,
            emiStartDate: startDate,
            emiAmount: emiAmountCalc,
            guarantor: guarantor ? {
                ...guarantor,
                cnicProofImage: guarantorCnicUrl
            } : undefined,
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

        // ─── NOTIFY SHOPKEEPER ──────────────────────────────────────────
        // Ek bar success response bhej diya, ab background me shopkeeper ko notify karo
        const shopkeeper = await Shopkeeper.findById(req.user._id);
        if (shopkeeper && shopkeeper.fcmToken) {
            try {
                await admin.messaging().send({
                    token: shopkeeper.fcmToken,
                    notification: {
                        title: ' New Device Registered!',
                        body: `${customerName} (IMEI: ${imei.substring(0, 8)}...) has been added to your database.`
                    },
                    data: {
                        type: 'NEW_REGISTRATION',
                        imei: device.imei,
                        customerName: device.customerName
                    },
                    android: {
                        priority: 'high'
                    }
                });
                console.log(`[NOTIFY] Shopkeeper notified of new registration: ${imei}`);
            } catch (err) {
                console.error('[NOTIFY] Failed to notify shopkeeper:', err.message);
            }
        }
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
            .select('status imei imei2 brand model platform customerName phoneNumber cnic profilePicture cnicProofImage productName totalPrice downPayment balance emiTenure emiAmount emiStartDate guarantor registeredAt smsCodes controls appRestrictions location geofence locationHistory')
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
            .select('imei imei2 brand model platform customerName phoneNumber cnic profilePicture cnicProofImage productName totalPrice downPayment balance emiTenure emiAmount emiStartDate guarantor status deregisteredAt registeredAt smsCodes controls appRestrictions location geofence locationHistory')
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

// GET /api/devices/dashboard-analytics
// Comprehensive analytics for shopkeeper dashboard
router.get('/dashboard-analytics', protect, async (req, res) => {
    try {
        const shopkeeperId = req.user._id;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // 1. Monthly Collection (Total amount paid this month)
        const monthlyCollection = await EmiPayment.aggregate([
            { $match: { shopkeeper: shopkeeperId, status: 'Paid', paidDate: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        // 2. EMI Collection Rate (Ratio of Paid vs Total Due)
        const collectionStats = await EmiPayment.aggregate([
            { $match: { shopkeeper: shopkeeperId, dueDate: { $lte: now } } },
            {
                $group: {
                    _id: null,
                    paid: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, 1, 0] } },
                    total: { $sum: 1 }
                }
            }
        ]);
        const collectionRate = collectionStats.length > 0 ? (collectionStats[0].paid / collectionStats[0].total * 100).toFixed(1) : 0;

        // 3. High Risk Customers (>= 2 Overdue EMIs)
        const highRiskResults = await EmiPayment.aggregate([
            { $match: { shopkeeper: shopkeeperId, status: 'Unpaid', dueDate: { $lte: now } } },
            { $group: { _id: '$device', overdueCount: { $sum: 1 } } },
            { $match: { overdueCount: { $gte: 2 } } },
            { $lookup: { from: 'devices', localField: '_id', foreignField: '_id', as: 'deviceInfo' } },
            { $unwind: '$deviceInfo' }
        ]);

        // 4. Overdue Trend (Unpaid EMIs by Month for last 6 months)
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        const overdueTrend = await EmiPayment.aggregate([
            { $match: { shopkeeper: shopkeeperId, status: 'Unpaid', dueDate: { $gte: sixMonthsAgo, $lte: now } } },
            {
                $group: {
                    _id: { month: { $month: '$dueDate' }, year: { $year: '$dueDate' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        // 5. Best Paying Customers (Top 5 by total paid amount)
        const bestCustomers = await EmiPayment.aggregate([
            { $match: { shopkeeper: shopkeeperId, status: 'Paid' } },
            { $group: { _id: '$device', totalPaid: { $sum: '$amount' } } },
            { $sort: { totalPaid: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'devices', localField: '_id', foreignField: '_id', as: 'deviceInfo' } },
            { $unwind: '$deviceInfo' }
        ]);

        // 6. Device Status (Locked vs Unlocked)
        const deviceStatus = await Device.aggregate([
            { $match: { shopkeeper: shopkeeperId, isDeregistered: false } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            data: {
                monthlyCollection: monthlyCollection[0]?.total || 0,
                collectionRate,
                highRiskCount: highRiskResults.length,
                overdueTrend: overdueTrend.map(t => ({ month: t._id.month, count: t.count })),
                bestCustomers: bestCustomers.map(c => ({ name: c.deviceInfo.customerName, amount: c.totalPaid })),
                deviceStats: {
                    locked: deviceStatus.find(s => s._id === 'Locked')?.count || 0,
                    unlocked: deviceStatus.find(s => s._id === 'Unlocked')?.count || 0
                }
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

// GET /api/devices/public/:imei
// Public route for customer app to fetch its own status and shop details
router.get('/public/:imei', async (req, res) => {
    try {
        const device = await Device.findOne({ imei: req.params.imei }).populate('shopkeeper', 'name phone shopName');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        // Fetch EMI summary
        const emis = await EmiPayment.find({ device: device._id }).sort({ installmentNumber: 1 });
        const unpaidCount = emis.filter(e => e.status === 'Unpaid').length;
        const paidCount = emis.filter(e => e.status === 'Paid').length;

        // Find the next due EMI
        const nextEmi = emis.find(e => e.status === 'Unpaid');

        // Robust shopkeeper data extraction
        const shopInfo = device.shopkeeper ? {
            _id: device.shopkeeper._id,
            name: device.shopkeeper.name,
            phone: device.shopkeeper.phone,
            shopName: device.shopkeeper.shopName || device.shopkeeper.name,
            role: device.shopkeeper.role
        } : {
            name: 'Authorized Dealer',
            phone: 'Contact Provider',
            shopName: 'Authorized Dealer'
        };

        res.json({
            success: true,
            data: {
                device: {
                    imei: device.imei,
                    status: device.status,
                    customerName: device.customerName,
                    emiAmount: device.emiAmount || 0,
                    productName: device.productName,
                    smsCodes: device.smsCodes,
                    shopkeeper: shopInfo
                },
                emiSummary: {
                    total: emis.length,
                    paid: paidCount,
                    unpaid: unpaidCount,
                    nextEmi: nextEmi ? {
                        amount: nextEmi.amount,
                        dueDate: nextEmi.dueDate
                    } : null
                }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// GET /api/devices/:imei
// Full device details (Action + Device Detail + Customer + EMI Detail tabs)
router.get('/:imei', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        // Non-admins can only see their own devices
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).populate('shopkeeper', 'name phone shopName');
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

        // Key is NOT released back to the shopkeeper upon deregistration.
        // It stays marked as used.

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

        console.log(`[Control Request] Action: ${action}, State: ${JSON.stringify(state)}, IMEI: ${req.params.imei}`);

        // 0. SPECIAL: Geofence Update
        if (action === 'geofence_update') {
            const currentGeofence = device.geofence || {};

            device.geofence = {
                isEnabled: !!state.isEnabled,
                lat: state.lat !== undefined ? state.lat : currentGeofence.lat,
                lng: state.lng !== undefined ? state.lng : currentGeofence.lng,
                radius: state.radius !== undefined ? Number(state.radius) : (currentGeofence.radius || 5),
                lastBreachAt: currentGeofence.lastBreachAt || null
            };

            console.log(`[Geofence Update] Final Model: ${JSON.stringify(device.geofence)}`);

            device.markModified('geofence');
            await device.save();
            return res.json({ success: true, message: 'Geofence protocol updated successfully' });
        }

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
            else if (action === 'autoLockOnSimChange') targetName = 'auto_lock_sim';
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
        // 4. Manual Push Notification
        else if (action === 'manual_notification') {
            const { title, body } = state;
            console.log(`[Manual Notification] Sending to: ${device.customerName}, Title: ${title}`);

            if (device.fcmToken) {
                await admin.messaging().send({
                    token: device.fcmToken,
                    notification: {
                        title: title || 'Security Warning!',
                        body: body || 'Outstanding EMI detected. Please pay to avoid device lock.'
                    },
                    data: {
                        type: 'MANUAL_ALERT',
                        imei: device.imei
                    },
                    android: {
                        priority: 'high'
                    }
                });
            }
            return res.json({ success: true, message: 'Push notification sent to device' });
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

// ─────────────────────────────────────────────
// Helper: Calculate distance between two points (km)
// ─────────────────────────────────────────────
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// POST /api/devices/:imei/location
// Receives location, saves to history (7 days), checks geofence
router.post('/:imei/location', async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const imei = req.params.imei;

        const device = await Device.findOne({ imei }).populate('shopkeeper');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        const now = new Date();

        // 1. Update Core Location
        device.location = { lat, lng, updatedAt: now };

        // 2. Add to History
        device.locationHistory.push({ lat, lng, timestamp: now });

        // 3. Keep only last 7 days of history
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        device.locationHistory = device.locationHistory.filter(h => h.timestamp > sevenDaysAgo);

        // 4. Geofencing Check
        if (device.geofence.isEnabled && device.geofence.lat && device.geofence.lng) {
            const distance = getDistance(lat, lng, device.geofence.lat, device.geofence.lng);

            if (distance > device.geofence.radius) {
                console.warn(`[GEOFENCE] BREACH: Device ${imei} is ${distance.toFixed(2)}km away from center.`);

                // Only alert if last breach was more than 1 hour ago (debounce)
                const lastBreach = device.geofence.lastBreachAt;
                if (!lastBreach || (now - lastBreach > 3600000)) {
                    device.geofence.lastBreachAt = now;
                    device.alerts.push({
                        type: 'GEOFENCE_BREACH',
                        message: `Device left its assigned zone (${distance.toFixed(2)}km away).`
                    });

                    // Notify Shopkeeper via FCM
                    if (device.shopkeeper && device.shopkeeper.fcmToken) {
                        try {
                            await admin.messaging().send({
                                token: device.shopkeeper.fcmToken,
                                notification: {
                                    title: '🚨 Geofence Breach!',
                                    body: `Warning: ${device.customerName}'s device is outside the city limits or assigned zone.`
                                },
                                data: {
                                    type: 'GEOFENCE_ALERT',
                                    imei: device.imei,
                                    distance: distance.toFixed(2)
                                },
                                android: {
                                    priority: 'high'
                                }
                            });
                        } catch (err) { console.error('FCM Error (Geofence):', err.message); }
                    }
                }
            }
        }

        await device.save();
        res.json({ success: true, message: 'Location updated and analyzed' });
    } catch (err) {
        console.error('Location Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/devices/:imei/location-history
// Returns 7 days of location data for rendering a trail on map
router.get('/:imei/location-history', protect, async (req, res) => {
    try {
        const query = { imei: req.params.imei };
        if (req.user.role !== 'admin') query.shopkeeper = req.user._id;

        const device = await Device.findOne(query).select('imei customerName locationHistory');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        res.json({
            success: true,
            data: {
                imei: device.imei,
                customerName: device.customerName,
                history: device.locationHistory
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/update-token
router.post('/update-token', async (req, res) => {
    try {
        const { imei, fcmToken, isShopkeeper } = req.body;

        if (isShopkeeper) {
            // If the user is logged in, use their ID from the request or provide it in body if unauth (risky)
            // Better to use protect middleware for shopkeeper token updates
            return res.status(400).json({ success: false, message: 'Use /update-shopkeeper-token for shopkeepers' });
        }

        if (!imei || !fcmToken) {
            return res.status(400).json({ success: false, message: 'imei and fcmToken are required' });
        }
        const device = await Device.findOneAndUpdate({ imei }, { fcmToken }, { new: true });
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
        res.json({ success: true, message: 'Device FCM token updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/update-shopkeeper-token
router.post('/update-shopkeeper-token', protect, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ success: false, message: 'fcmToken is required' });

        const shopkeeper = await Shopkeeper.findByIdAndUpdate(req.user._id, { fcmToken }, { new: true });
        res.json({ success: true, message: 'Shopkeeper FCM token updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/devices/:imei/sim-changed
// Body: { iccid, phoneNumber }
router.post('/:imei/sim-changed', async (req, res) => {
    try {
        const { iccid, phoneNumber } = req.body;
        const imei = req.params.imei;

        const device = await Device.findOne({ imei }).populate('shopkeeper');
        if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

        console.log(`[SIM Change] IMEI: ${imei}, New ICCID: ${iccid}`);

        // 1. Update SIM Info History
        if (device.simInfo.iccid && device.simInfo.iccid !== iccid) {
            device.simInfo.history.push({
                iccid: device.simInfo.iccid,
                phoneNumber: device.simInfo.phoneNumber,
                changedAt: device.simInfo.lastUpdated || new Date()
            });
        }

        device.simInfo.iccid = iccid;
        if (phoneNumber && phoneNumber !== device.simInfo.phoneNumber) {
            device.simInfo.phoneNumber = phoneNumber;
            // Also update top-level phoneNumber so shopkeeper can see it clearly
            device.phoneNumber = phoneNumber;
        }
        device.simInfo.lastUpdated = new Date();

        // 2. Check Auto-Lock
        let lockApplied = false;
        if (device.controls.autoLockOnSimChange) {
            device.status = 'Locked';
            lockApplied = true;

            // Send FCM to device to enforce lock
            await sendFCM(device.fcmToken, {
                type: 'CONTROL',
                command: 'lock',
                target: 'device',
                state: 'true'
            });
        }

        await device.save();

        // 3. Notify Shopkeeper
        if (device.shopkeeper && device.shopkeeper.fcmToken) {
            await admin.messaging().send({
                token: device.shopkeeper.fcmToken,
                notification: {
                    title: '🚨 SIM Change Alert!',
                    body: `Customer ${device.customerName} changed their SIM card. Device ${lockApplied ? 'is now LOCKED' : 'detected change'}.`
                },
                data: {
                    type: 'SIM_ALERT',
                    imei: device.imei,
                    customerName: device.customerName,
                    newIccid: iccid || 'Unknown'
                },
                android: {
                    priority: 'high'
                }
            });
            console.log(`[SIM Change] Notification sent to shopkeeper: ${device.shopkeeper.name}`);
        }

        res.json({
            success: true,
            message: 'SIM change recorded',
            autoLocked: lockApplied
        });

    } catch (err) {
        console.error('SIM Change Error:', err);
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

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();


// ── Firebase Admin Init ──────────────────────
// ── Firebase Admin Init ──────────────────────
try {
    let serviceAccount;

    // Check if we have the JSON as an Environment Variable (Secure for Vercel)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        console.log('Firebase Admin initialized from Environment Variables');
    } else {
        // Fallback to local file for Development
        // File is named serviceAccountKey.json.json in this project
        serviceAccount = require('./serviceAccountKey.json.json');
        console.log('Firebase Admin initialized from local file');
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (error) {
    console.warn('Firebase Admin: serviceAccountKey not found in Env or File — FCM disabled');
    console.error(error.message);
}

const app = express();

// ── Static Files (APK Download Gateway) ──────
const path = require('path');
app.use('/dl', express.static(path.join(__dirname, 'public/apk')));
// Backward/forward compatible alias:
// The Android app QR screen expects `/apk/v7_app.apk` (not `/dl/v7_app.apk`).
// Serving both paths avoids "downloaded wrong file" provisioning errors.
app.use('/apk', express.static(path.join(__dirname, 'public/apk')));

// ── Middleware ───────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased to 50mb for multiple base64 images
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/device');
const emiRoutes = require('./routes/emi');
const adminRoutes = require('./routes/admin');
const keyOrderRoutes = require('./routes/keyOrders');

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/emis', emiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/key-orders', keyOrderRoutes);

// ── Auto-Update Route (Disabled by default - uncomment when pushing new version) ──
app.get('/api/version', (req, res) => {
    // Jab app update karni ho, tab versionCode app se zyada rakhein aur success: true karein
    res.json({
        success: false,
        message: "No mandatory update available",
        versionCode: 3,
        versionName: "v1.2",
        downloadUrl: "https://pk-locker-api.vercel.app/apk/update.apk",
        forceUpdate: false
    });
});




// ── Root Route for Vercel ────────────────────
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #0F172A; color: white; height: 100vh;">
            <h1 style="color: #3B82F6;">🚀 PK LOCKER SERVER</h1>
            <p>System is online and secure.</p>
            <div style="background: rgba(255,255,255,0.05); padding: 20px; display: inline-block; border-radius: 10px;">
                Status: <span style="color: #22C55E;">ACTIVE</span><br>
                Uptime: ${process.uptime().toFixed(0)} seconds
            </div>
        </div>
    `);
});

// ── Health check ─────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'okk', timestamp: new Date().toISOString() });
});

// ── ADB PROXY ENDPOINTS (Local PC Relay) ─────
// These endpoints let the shopkeeper app run ADB commands on the
// customer device via the PC (where both phones are connected via Wireless ADB).
const { execFile } = require('child_process');
const ADB_PATH = process.env.ADB_PATH || 'adb'; // set ADB_PATH in .env if needed

function runAdb(args, timeoutMs = 15000) {
    return new Promise((resolve) => {
        execFile(ADB_PATH, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) {
                resolve({ success: false, output: stderr || err.message });
            } else {
                resolve({ success: true, output: stdout.trim() });
            }
        });
    });
}

// GET /api/adb/devices  — list all connected ADB devices
app.get('/api/adb/devices', async (req, res) => {
    const result = await runAdb(['devices', '-l']);
    const lines = result.output.split('\n').filter(l => l.includes('\t'));
    const devices = lines.map(l => {
        const parts = l.trim().split(/\s+/);
        return { id: parts[0], status: parts[1], info: parts.slice(2).join(' ') };
    });
    res.json({ success: true, devices, raw: result.output });
});

// POST /api/adb/exec  — run shell command on a specific device
// Body: { deviceId: "adb-xxxxx._adb-tls-connect._tcp", command: "dpm set-device-owner ..." }
app.post('/api/adb/exec', async (req, res) => {
    const { deviceId, command } = req.body;
    if (!deviceId || !command) {
        return res.status(400).json({ success: false, message: 'deviceId and command are required' });
    }
    console.log(`[ADB PROXY] Device: ${deviceId} | Command: ${command}`);
    const result = await runAdb(['-s', deviceId, 'shell', command], 20000);
    res.json({ success: result.success, output: result.output });
});

// POST /api/adb/setup-device-owner
// Full automated setup: set Device Owner + grant all permissions
// Body: { deviceId?: "...", targetIp?: "192.168.1.37:5555" }
app.post('/api/adb/setup-device-owner', async (req, res) => {
    let { deviceId, targetIp } = req.body;

    if (!deviceId && !targetIp) {
        return res.status(400).json({ success: false, message: 'deviceId or targetIp is required' });
    }

    const logs = [];

    if (targetIp) {
        if (!targetIp.includes(':')) targetIp = `${targetIp}:5555`;
        logs.push(`Connecting ADB to ${targetIp}...`);
        const connRes = await runAdb(['connect', targetIp], 10000);
        logs.push(`Connect Output: ${connRes.output}`);
        deviceId = targetIp;
    }

    const run = async (cmd) => {
        const r = await runAdb(['-s', deviceId, 'shell', cmd], 20000);
        logs.push(`CMD: ${cmd}\nRESULT: ${r.output}`);
        return r;
    };

    logs.push(`Starting full Device Owner setup on: ${deviceId}`);

    // 1. Set Device Owner
    const r1 = await run('dpm set-device-owner com.pksafe.lock.manager/com.pksafe.lock.manager.receiver.AdminReceiver');
    logs.push(`Device Owner: ${r1.success ? '✅ SUCCESS' : '❌ FAILED'}`);

    // 2. Grant Overlay
    await run('appops set com.pksafe.lock.manager SYSTEM_ALERT_WINDOW allow');
    logs.push('Overlay Permission: ✅ Granted');

    // 3. Enable Accessibility (Anti-Uninstall Guard)
    await run('settings put secure enabled_accessibility_services com.pksafe.lock.manager/com.pksafe.lock.manager.service.AntiUninstallService');
    await run('settings put secure accessibility_enabled 1');
    logs.push('Accessibility Guard: ✅ Enabled');

    // 4. Grant SMS & Location
    await run('pm grant com.pksafe.lock.manager android.permission.RECEIVE_SMS');
    await run('pm grant com.pksafe.lock.manager android.permission.READ_SMS');
    await run('pm grant com.pksafe.lock.manager android.permission.ACCESS_FINE_LOCATION');
    await run('pm grant com.pksafe.lock.manager android.permission.READ_PHONE_STATE');
    logs.push('SMS, Location & Phone Permissions: ✅ Granted');

    logs.push('🎉 Full Setup Complete!');
    res.json({ success: r1.success, logs });
});

// ── 404 handler ──────────────────────────────
app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});


// ── Global error handler ─────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});


// ── MongoDB Connection ────────────────────────
// EMI Enforcement Cron Job
const { initEmiCron } = require('./cron/emiEnforcer');
const { initRemindersCron } = require('./cron/emiReminders');

// Fix for "querySrv ECONNREFUSED" DNS issue on some networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);


const connectDB = async () => {
    try {
        const mongoUri = 'mongodb+srv://auto-wheel-apps:AutoWheels123@auto-wheels.m4wrf.mongodb.net/pklocker';
        await mongoose.connect(mongoUri);
        console.log('MongoDB connection SUCCESS');

        // Start the automated enforcement cron tasks
        initEmiCron();
        initRemindersCron();

    } catch (error) {
        console.error('MongoDB connection FAIL', error);
        process.exit(1);
    }
};

connectDB();

// ── FOR VERCEL DEPLOYMENT ────────────────────
// Export and conditionally listen

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`\n🚀 APK Gateway running on port ${PORT}`);
});

module.exports = app;

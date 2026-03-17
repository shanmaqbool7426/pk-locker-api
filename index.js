const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// ── Firebase Admin Init ──────────────────────
try {
    // File is named serviceAccountKey.json.json in this project
    const serviceAccount = require('./serviceAccountKey.json.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
} catch (error) {
    console.warn('Firebase Admin: serviceAccountKey.json not found — FCM disabled');
}

const app = express();

// ── Middleware ───────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10 mb to allow base64 profile pictures
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/device');
const emiRoutes = require('./routes/emi');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/emis', emiRoutes);
app.use('/api/admin', adminRoutes);

// ── Health check ─────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
const MONGO_URI = 'mongodb+srv://auto-wheel-apps:AutoWheels123@auto-wheels.m4wrf.mongodb.net/pklocker';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));


const PORT = 5000;
app.listen(PORT, () => {
    console.log(`\n🚀 U.S. Locker API running on port ${PORT}`);
    console.log(`\nAvailable routes:`);
    console.log(`  POST   /api/auth/login`);
    console.log(`  POST   /api/auth/register          (admin only)`);
    console.log(`  GET    /api/auth/me`);
    console.log(`  PATCH  /api/auth/change-password`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  POST   /api/devices/register`);
    console.log(`  POST   /api/devices/update-token`);
    console.log(`  GET    /api/devices/stats`);
    console.log(`  GET    /api/devices                (active customers)`);
    console.log(`  GET    /api/devices/deregistered`);
    console.log(`  GET    /api/devices/:imei`);
    console.log(`  PUT    /api/devices/:imei`);
    console.log(`  POST   /api/devices/:imei/lock`);
    console.log(`  POST   /api/devices/:imei/unlock`);
    console.log(`  POST   /api/devices/:imei/deregister`);
    console.log(`  POST   /api/devices/:imei/controls`);
    console.log(`  POST   /api/devices/:imei/location`);
    console.log(`  GET    /api/devices/:imei/status`);
    console.log(`  GET    /api/devices/:imei/sms-codes`);
    console.log(`  GET    /api/devices/:imei/location`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  GET    /api/emis/upcoming`);
    console.log(`  GET    /api/emis/device/:imei`);
    console.log(`  POST   /api/emis/:emiId/mark-paid`);
    console.log(`  PUT    /api/emis/device/:imei`);
    console.log(`  GET    /api/emis/history/:imei`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  GET    /api/admin/shopkeepers       (admin only)`);
    console.log(`  POST   /api/admin/shopkeepers       (admin only)`);
    console.log(`  PATCH  /api/admin/shopkeepers/:id   (admin only)`);
    console.log(`  DELETE /api/admin/shopkeepers/:id   (admin only)`);
    console.log(`  POST   /api/admin/keys/allocate     (admin only)`);
    console.log(`  GET    /api/admin/keys              (admin only)`);
    console.log(`  GET    /api/admin/devices           (admin only)`);
    console.log(`  GET    /api/admin/stats             (admin only)`);
    console.log('');
});

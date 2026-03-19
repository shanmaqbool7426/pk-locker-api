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


// ── FOR VERCEL DEPLOYMENT ────────────────────
// Export and conditionally listen
if (process.env.NODE_ENV !== 'production') {
    const PORT = 5000;
    app.listen(PORT, () => {
        console.log(`\n🚀 APK Gateway running on port ${PORT}`);
    });
}

module.exports = app;

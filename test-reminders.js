const mongoose = require('mongoose');
const EmiPayment = require('./models/EmiPayment');
const { checkUpcomingReminders } = require('./cron/emiReminders');
require('dotenv').config();
const admin = require('firebase-admin');

// Firebase Admin Init
try {
    const serviceAccount = require('./serviceAccountKey.json.json');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.error('Firebase Admin init failed in test:', e.message);
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://auto-wheel-apps:AutoWheels123@auto-wheels.m4wrf.mongodb.net/pklocker';

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        
        let emi = await EmiPayment.findOne({ status: 'Unpaid' }).sort({ createdAt: -1 });
        if (emi) {
            console.log('Original EMI Due Date:', emi.dueDate);
            
            // Set Due Date to TOMORROW (1 Day from now)
            const newDate = new Date();
            newDate.setDate(newDate.getDate() + 1); // 1 day in the future
            emi.dueDate = newDate;
            await emi.save();
            console.log(`EMI [${emi._id}] Updated. New Due Date (TOMORROW):`, emi.dueDate);

            console.log('\n--- Triggering Reminders Cron Now ---');
            await checkUpcomingReminders();
            
        } else {
            console.log('No Unpaid EMI found to test with.');
        }

    } catch(e) {
        console.error('Error:', e);
    } finally {
        mongoose.disconnect();
    }
}
run();

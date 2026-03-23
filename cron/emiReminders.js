const cron = require('node-cron');
const EmiPayment = require('../models/EmiPayment');
const Device = require('../models/Device');
const { sendFCM } = require('../utils/fcm');
const admin = require('firebase-admin');

// Mock communication gateway for WhatsApp & SMS integrations (e.g. Twilio, UltraMsg)
const sendCommunication = async (channel, toPhone, message) => {
    console.log(`\n[GATEWAY: ${channel.toUpperCase()}] To: ${toPhone}`);
    console.log(`[MESSAGE_BODY] ${message}\n`);
    // NOTE: For live environments, replace with Twilio, Green-API, UltraMsg, etc.
};

// Extends sendFCM to support pure push notifications instead of just background data syncs
const sendPushNotification = async (fcmToken, title, body) => {
    if (!fcmToken) return;
    try {
        await admin.messaging().send({
            notification: { title, body },
            token: fcmToken,
            android: { priority: 'high' }
        });
        console.log(`[FCM Notification Push] Success: ${title}`);
    } catch(e) {
        console.error(`[FCM Push Error] ${e.message}`);
    }
}

const checkUpcomingReminders = async () => {
    console.log('[EMI Reminders] Starting daily upcoming/due payment checks...');
    try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Target specific windows (0 days, 1 day, 3 days ahead)
        // Check everything that is Unpaid
        const unpaidEmis = await EmiPayment.find({ status: 'Unpaid' }).populate('device');

        for (const emi of unpaidEmis) {
            const device = emi.device;
            if (!device || device.isDeregistered) continue;

            const dueDate = new Date(emi.dueDate);
            const startOfDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
            
            // Difference in days (floor used to ignore exact hour mismatches)
            const diffTime = startOfDue - startOfToday;
            const daysUntilDue = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            const phone = device.phoneNumber || "Unknown Phone";
            const amt = emi.amount;
            const dateStr = startOfDue.toISOString().split('T')[0];

            if (daysUntilDue === 3) {
                await sendCommunication('whatsapp', phone, `Dear ${device.customerName}, your EMI of Rs. ${amt} for ${device.brand} is due on ${dateStr}. Please ensure payment to avoid any late notices.`);
            } 
            else if (daysUntilDue === 1) {
                const msg = `ALERT: Your EMI of Rs. ${amt} is due TOMORROW (${dateStr}). Pay immediately to avoid service interruptions.`;
                await sendCommunication('sms', phone, msg);
                await sendPushNotification(device.fcmToken, "EMI Due Tomorrow", msg);
            } 
            else if (daysUntilDue === 0) {
                const msg = `URGENT: Your EMI of Rs. ${amt} is DUE TODAY. Please pay immediately.`;
                await sendCommunication('sms', phone, msg);
                await sendPushNotification(device.fcmToken, "EMI DUE TODAY", msg);
                
                // Add an alert to the system log so shopkeepers are aware
                device.alerts.push({
                    type: 'EMI_DUE_TODAY',
                    message: `Customer reached deadline today: Rs. ${amt} due.`,
                    timestamp: new Date()
                });
                await device.save();
            }
        }
    } catch(err) {
        console.error('[EMI Reminders] Error:', err.message);
    }
};

const initRemindersCron = () => {
    cron.schedule('0 9 * * *', () => { // Run at 9:00 AM every day
        checkUpcomingReminders();
    }, {
        scheduled: true,
        timezone: "Asia/Karachi"
    });
    console.log('[EMI Reminders] Cron job initialized (Runs at 9:00 AM PKT)');
}

module.exports = { initRemindersCron, checkUpcomingReminders };

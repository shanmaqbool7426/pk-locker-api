const cron = require('node-cron');
const EmiPayment = require('../models/EmiPayment');
const Device = require('../models/Device');
const { sendFCM } = require('../utils/fcm');
const { logActivity } = require('../utils/activityLogger');
const admin = require('firebase-admin');

// Mock communication gateway for WhatsApp & SMS integrations (e.g. Twilio, UltraMsg)
const sendCommunication = async (channel, toPhone, message) => {
    console.log(`\n[GATEWAY: ${channel.toUpperCase()}] To: ${toPhone}`);
    console.log(`[MESSAGE_BODY] ${message}\n`);
    // NOTE: For live environments, replace with Twilio, Green-API, UltraMsg, etc.
};

// Extends sendFCM to support pure push notifications instead of just background data syncs
const sendPushNotification = async (fcmToken, title, body) => {
    if (!fcmToken) {
        console.log(`[FCM Push] Skipped — no token for device`);
        return;
    }
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
        
        // Find all unpaid EMIs (active devices only)
        const unpaidEmis = await EmiPayment.find({ status: 'Unpaid' }).populate('device');

        for (const emi of unpaidEmis) {
            const device = emi.device;
            if (!device || device.isDeregistered) continue;

            const dueDate = new Date(emi.dueDate);
            const startOfDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
            
            // Difference in days (floor to ignore exact hour mismatches)
            const diffTime = startOfDue - startOfToday;
            const daysUntilDue = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            const phone = device.phoneNumber || "Unknown Phone";
            const amt = emi.amount;
            const dateStr = startOfDue.toISOString().split('T')[0];

            // ── 3 DAYS OR LESS BEFORE DUE (including overdue) ──────────────
            if (daysUntilDue <= 3) {
                let title, msg;

                if (daysUntilDue === 3) {
                    title = "EMI Reminder";
                    msg = `Dear ${device.customerName}, your EMI of Rs. ${amt} for ${device.brand || 'device'} is due on ${dateStr}. Please pay to avoid late notices.`;
                }
                else if (daysUntilDue === 2) {
                    title = "EMI Due in 2 Days";
                    msg = `Your EMI of Rs. ${amt} is due on ${dateStr}. Pay now to avoid penalties.`;
                }
                else if (daysUntilDue === 1) {
                    title = "EMI Due Tomorrow";
                    msg = `ALERT: Your EMI of Rs. ${amt} is due TOMORROW (${dateStr}). Pay immediately to avoid service interruptions.`;
                }
                else if (daysUntilDue === 0) {
                    title = "EMI DUE TODAY";
                    msg = `URGENT: Your EMI of Rs. ${amt} is DUE TODAY. Please pay immediately.`;
                }
                else {
                    // Overdue (daysUntilDue < 0)
                    const overdueDays = Math.abs(daysUntilDue);
                    title = "EMI OVERDUE";
                    msg = `WARNING: Your EMI of Rs. ${amt} was due on ${dateStr} (${overdueDays} day${overdueDays > 1 ? 's' : ''} overdue). Pay immediately to avoid device lock.`;
                }

                // Push notification every day in the window
                await sendPushNotification(device.fcmToken, title, msg);

                // SMS/WhatsApp at key milestones
                if (daysUntilDue === 3) {
                    await sendCommunication('whatsapp', phone, msg);
                }
                else if (daysUntilDue <= 1) {
                    await sendCommunication('sms', phone, msg);
                }

                // ── AUTO-LOCK ON OVERDUE ──────────────────────────────────────
                // When due date has passed (daysUntilDue < 0), auto-lock the device
                if (daysUntilDue < 0) {
                    const overdueDays = Math.abs(daysUntilDue);
                    
                    // Update device status to Locked
                    if (device.status !== 'Locked') {
                        device.status = 'Locked';
                        await device.save();
                        console.log(`[EMI Auto-Lock] Device ${device.imei} LOCKED — EMI overdue by ${overdueDays} day(s)`);
                    }

                    // Send FCM lock command to device
                    await sendFCM(device.fcmToken, {
                        type: 'CONTROL',
                        command: 'lock',
                        target: 'device',
                        state: 'true'
                    });

                    // Log activity for shopkeeper
                    logActivity({
                        imei: device.imei,
                        shopkeeperId: device.shopkeeper,
                        action: 'emi_overdue_lock',
                        details: `Device auto-locked: EMI Rs. ${amt} overdue by ${overdueDays} day(s) (due: ${dateStr})`,
                        performedBy: 'system'
                    });

                    // Add alert to device for shopkeeper visibility
                    device.alerts.push({
                        type: 'EMI_OVERDUE_LOCK',
                        message: `Device auto-locked: EMI Rs. ${amt} overdue by ${overdueDays} day(s). Due: ${dateStr}`,
                        timestamp: new Date()
                    });
                    await device.save();

                    console.log(`[EMI Auto-Lock] IMEI ${device.imei} — overdue ${overdueDays} day(s), lock command sent`);
                }
                // Due day: log alert but NO lock yet (last chance)
                else if (daysUntilDue === 0) {
                    device.alerts.push({
                        type: 'EMI_DUE_TODAY',
                        message: `Customer reached deadline today: Rs. ${amt} due.`,
                        timestamp: new Date()
                    });
                    await device.save();
                }
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

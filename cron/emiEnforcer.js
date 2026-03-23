const cron = require('node-cron');
const EmiPayment = require('../models/EmiPayment');
const Device = require('../models/Device');
const { sendFCM } = require('../utils/fcm');

const checkOverdueEmis = async () => {
    console.log('[EMI Enforcer] Starting daily EMI compliance check...');
    try {
        const now = new Date();
        
        const overdueEmis = await EmiPayment.find({
            status: 'Unpaid',
            dueDate: { $lt: now }
        }).populate('device');

        let lockedCount = 0;

        for (const emi of overdueEmis) {
            const device = emi.device;
            if (!device || device.isDeregistered) continue;

            const diffTime = Math.abs(now - new Date(emi.dueDate));
            const overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            // Day 5 Overdue => FULL DEVICE LOCK
            if (overdueDays >= 5 && device.status !== 'Locked') {
                device.status = 'Locked';
                device.alerts.push({
                    type: 'EMI_LOCK',
                    message: `Device locked due to EMI overdue by ${overdueDays} days.`,
                    timestamp: new Date()
                });
                await device.save();

                await sendFCM(device.fcmToken, {
                    type: 'CONTROL',
                    command: 'lock',
                    target: 'device',
                    state: 'true'
                });
                
                lockedCount++;
                console.log(`[EMI Enforcer] CRITICAL: IMEI ${device.imei} locked (Overdue ${overdueDays} days)`);
            }
        }

        console.log(`[EMI Enforcer] Completed! Actions => Locked: ${lockedCount}`);
    } catch (err) {
        console.error('[EMI Enforcer] Error running compliance check:', err.message);
    }
};

const initEmiCron = () => {
    cron.schedule('0 0 * * *', () => {
        checkOverdueEmis();
    }, {
        scheduled: true,
        timezone: "Asia/Karachi"
    });
    console.log('[EMI Enforcer] Cron job initialized (Midnight execution)');
};

module.exports = { initEmiCron, checkOverdueEmis };

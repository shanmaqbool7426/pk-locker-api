const cron = require('node-cron');
const EmiPayment = require('../models/EmiPayment');
// Device model not needed — comes via populate('device') on EmiPayment
// sendFCM not needed — NO auto-lock; only shopkeeper/admin locks manually

const checkOverdueEmis = async () => {
    console.log('[EMI Enforcer] Starting daily EMI compliance check...');
    try {
        const now = new Date();
        
        const overdueEmis = await EmiPayment.find({
            status: 'Unpaid',
            dueDate: { $lt: now }
        }).populate('device');

        let overdueCount = 0;

        for (const emi of overdueEmis) {
            const device = emi.device;
            if (!device || device.isDeregistered) continue;

            const diffTime = Math.abs(now - new Date(emi.dueDate));
            const overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            // ── LOG ONLY — NO AUTO LOCK ──────────────────────────────────
            // Device is NEVER locked automatically, regardless of overdue days.
            // Only the shopkeeper or admin can manually lock a customer device.
            // This cron just logs overdue EMIs for reporting purposes.
            if (overdueDays >= 1) {
                overdueCount++;
                console.log(`[EMI Enforcer] OVERDUE: IMEI ${device.imei} — ${overdueDays} days past due (EMI Rs. ${emi.amount}). Awaiting manual action from shopkeeper/admin.`);
            }
        }

        console.log(`[EMI Enforcer] Completed! Overdue EMIs found: ${overdueCount} (NO auto-lock — manual action required)`);
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

const ActivityLog = require('../models/ActivityLog');

/**
 * Log an activity for a device.
 * Safe to call without await — catches its own errors.
 *
 * @param {Object} opts
 * @param {string} opts.imei         - Device IMEI
 * @param {string} opts.shopkeeperId - Shopkeeper ObjectId
 * @param {string} opts.action       - Action enum value
 * @param {string} opts.details      - Human-readable summary
 * @param {string} opts.performedBy  - 'shopkeeper' | 'system' | 'device' | 'cron'
 */
async function logActivity({ imei, shopkeeperId, action, details = '', performedBy = 'shopkeeper' }) {
    try {
        await ActivityLog.create({
            imei,
            shopkeeper: shopkeeperId,
            action,
            details,
            performedBy
        });
    } catch (err) {
        // Activity logging should never break the main flow
        console.error('[ActivityLog] Failed to log:', action, err.message);
    }
}

module.exports = { logActivity };

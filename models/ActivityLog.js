const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    // Which device this activity belongs to
    imei: { type: String, required: true, index: true },
    shopkeeper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        required: true
    },

    // Action type — used for filtering and icon selection
    action: {
        type: String,
        enum: [
            'registered',
            'lock',
            'unlock',
            'deregister',
            'control_change',
            'app_restrict',
            'sim_changed',
            'geofence_breach',
            'location_update',
            'heartbeat',
            'command_ack',
            'unlock_all',
            'fcm_token_update'
        ],
        required: true
    },

    // Human-readable summary shown in UI
    details: { type: String, default: '' },

    // Who performed this action
    performedBy: {
        type: String,
        enum: ['shopkeeper', 'system', 'device', 'cron'],
        default: 'shopkeeper'
    },

    timestamp: { type: Date, default: Date.now }
});

// Compound index: fast lookup by imei + newest first
activityLogSchema.index({ imei: 1, timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

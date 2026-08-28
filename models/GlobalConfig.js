const mongoose = require('mongoose');

const globalConfigSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // e.g., "app_update"
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);

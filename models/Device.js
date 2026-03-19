const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
    // Hardware & Identity
    imei: { type: String, required: true, unique: true },
    imei2: { type: String },
    brand: { type: String },
    model: { type: String },
    androidVersion: { type: String },
    fcmToken: { type: String, default: null },

    // Platform
    platform: {
        type: String,
        enum: ['android', 'ios'],
        default: 'android'
    },

    // Customer Identity
    customerName: { type: String, required: true },
    cnic: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    profilePicture: { type: String, default: null }, // URL or base64
    cnicProofImage: { type: String, default: null }, // NEW: proof of CNIC (base64 or URL)

    // EMI Details
    productName: { type: String },
    totalPrice: { type: Number, default: 0 },
    downPayment: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    emiTenure: { type: Number, default: 1 }, // number of months
    emiStartDate: { type: Date },
    emiAmount: { type: Number, default: 0 },

    // Guarantor Details
    guarantor: {
        name: { type: String },
        mobile: { type: String },
        address: { type: String },
        cnicProofImage: { type: String, default: null } // NEW: Guarantor's CNIC proof image
    },

    // Status & Location
    status: {
        type: String,
        enum: ['Locked', 'Unlocked'],
        default: 'Unlocked'
    },
    location: {
        lat: { type: Number },
        lng: { type: Number },
        updatedAt: { type: Date }
    },

    // Controls (Restriction Flags)
    controls: {
        usbLock: { type: Boolean, default: false },
        cameraDisabled: { type: Boolean, default: false },
        installBlocked: { type: Boolean, default: false },
        uninstallBlocked: { type: Boolean, default: false },
        settingsBlocked: { type: Boolean, default: false },
        debuggingBlocked: { type: Boolean, default: false },
        outgoingCallsBlocked: { type: Boolean, default: false },
        softResetBlocked: { type: Boolean, default: false },
        softBootBlocked: { type: Boolean, default: false },
        autoLock: { type: Boolean, default: false },
        warningWallpaper: { type: String, default: null }, // URL to image
        warningAudio: { type: Boolean, default: false }
    },

    // Social Media / App Controls
    appRestrictions: {
        whatsapp: { type: Boolean, default: false },
        facebook: { type: Boolean, default: false },
        instagram: { type: Boolean, default: false },
        youtube: { type: Boolean, default: false },
        chrome: { type: Boolean, default: false },
        telegram: { type: Boolean, default: false },
        hotstar: { type: Boolean, default: false }
    },

    // Offline SMS Lock/Unlock Codes
    smsCodes: {
        lockCode: { type: String, default: null },
        unlockCode: { type: String, default: null }
    },

    // Deregistration
    isDeregistered: { type: Boolean, default: false },
    deregisteredAt: { type: Date, default: null },

    // Shopkeeper who owns this device
    shopkeeper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shopkeeper',
        required: true
    },

    registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Device', deviceSchema);

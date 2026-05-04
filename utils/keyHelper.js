const Key = require('../models/Key');
const Shopkeeper = require('../models/Shopkeeper');

/**
 * Allocate keys to a shopkeeper and handle referral bonuses
 */
const allocateKeysToShopkeeper = async (shopkeeperId, numKeys, platform) => {
    let keyRecord = await Key.findOne({ shopkeeper: shopkeeperId, platform: platform });
    if (!keyRecord) {
        keyRecord = new Key({ shopkeeper: shopkeeperId, platform: platform, totalKeys: 0, usedKeys: 0 });
    }
    keyRecord.totalKeys += parseInt(numKeys);
    keyRecord.updatedAt = new Date();
    await keyRecord.save();

    // --- Referral System Logic ---
    // If a shopkeeper buys at least 5 keys, the referrer gets 2 free keys
    if (parseInt(numKeys) >= 5) {
        const shopkeeper = await Shopkeeper.findById(shopkeeperId);
        
        if (shopkeeper && shopkeeper.referredByPhone && !shopkeeper.referralRewardClaimed) {
            const referrer = await Shopkeeper.findOne({ phone: shopkeeper.referredByPhone });
            if (referrer) {
                // Find or create referrer's key record
                let referrerKeys = await Key.findOne({ shopkeeper: referrer._id, platform: platform });
                if (!referrerKeys) {
                    referrerKeys = new Key({ shopkeeper: referrer._id, platform: platform, totalKeys: 0, usedKeys: 0 });
                }
                referrerKeys.totalKeys += 2; // +2 Free Keys
                await referrerKeys.save();

                // Mark reward as claimed so it only happens once
                shopkeeper.referralRewardClaimed = true;
                await shopkeeper.save();
                
                console.log(`[Referral] Rewarded ${referrer.name} (+2 keys) for referral: ${shopkeeper.name}`);
            }
        }
    }

    return keyRecord;
};

module.exports = { allocateKeysToShopkeeper };

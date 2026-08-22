const express = require('express');
const router = express.Router();
const KeyOrder = require('../models/KeyOrder');
const Key = require('../models/Key');
const { protect, adminOnly } = require('../middleware/auth');
const { allocateKeysToShopkeeper } = require('../utils/keyHelper');

// Dynamic Pricing: More keys = Lower price per key
const getDynamicPrice = (numKeys) => {
    const count = parseInt(numKeys);
    if (count >= 100) return 380; // Wholesale Tier
    if (count >= 50) return 400;  // Dealer Tier
    return 430;                   // Retail Tier
};

// POST /api/key-orders/wallet-pay
// SIMULATES direct wallet deduction (EasyPaisa/JazzCash STK Push)
router.post('/wallet-pay', protect, async (req, res) => {
    try {
        const { mobileNumber, method, numKeys, platform } = req.body;

        if (!mobileNumber || !method || !numKeys) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const unitPrice = getDynamicPrice(numKeys);
        const totalAmount = numKeys * unitPrice;

        // Simulate network/PIN processing delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 1. Create the Approved Order
        const order = new KeyOrder({
            shopkeeper: req.user._id,
            platform: platform || 'android',
            numKeys,
            unitPrice: unitPrice,
            totalAmount,
            paymentProofImage: `DIRECT_WALLET_${method.toUpperCase()}_${mobileNumber}`,
            status: 'Approved'
        });
        await order.save();

        // 2. Add keys to balance (via shared helper — handles referral bonus too)
        const updatedKeys = await allocateKeysToShopkeeper(req.user._id, numKeys, order.platform);

        res.json({
            success: true,
            message: `Payment Successful via ${method}! ${numKeys} keys added instantly.`,
            transactionId: `TXN_${Math.random().toString(36).substring(7).toUpperCase()}`,
            availableKeys: (updatedKeys.totalKeys - updatedKeys.usedKeys)
        });
    } catch (err) {
        console.error('Wallet pay error:', err);
        res.status(500).json({ success: false, message: 'Wallet payment simulation failed' });
    }
});



// POST /api/key-orders/checkout-safepay
// Step 1: Initialize payment with Safepay
router.post('/checkout-safepay', protect, async (req, res) => {
    try {
        const { numKeys, platform } = req.body;
        if (!numKeys) return res.status(400).json({ success: false, message: 'Number of keys required' });
        const unitPrice = getDynamicPrice(numKeys);
        const totalAmount = numKeys * unitPrice;

        // Safepay configuration from .env
        const apiKey = process.env.SAFEPAY_API_KEY;
        const baseUrl = process.env.SAFEPAY_BASE_URL;
        const checkoutUrlBase = process.env.SAFEPAY_CHECKOUT_URL;

        // 1. Create Tracker on Safepay (Order Initialization)
        const trackerResponse = await fetch(`${baseUrl}/order/v1/init`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-SFPY-MERCHANT-SECRET': apiKey
            },
            body: JSON.stringify({
                client: apiKey,
                amount: totalAmount,
                currency: 'PKR',
                environment: process.env.SAFEPAY_PRODUCTION === 'true' ? 'production' : 'sandbox'
            })
        });

        let trackerData;
        const responseText = await trackerResponse.text();
        try {
            trackerData = JSON.parse(responseText);
        } catch (e) {
            console.error('Safepay returned non-JSON response:', responseText.substring(0, 500));
            return res.status(500).json({ success: false, message: 'Safepay API returned an invalid response' });
        }
        
        if (!trackerResponse.ok) {
            console.error('Safepay tracker error:', trackerData);
            return res.status(400).json({ success: false, message: 'Could not initialize Safepay tracker' });
        }

        // Standard v1 response: { success: true, token: "..." }
        // Some versions: { data: { token: "..." } } or { data: { tracker: "..." } }
        const trackerToken = trackerData.token || 
                           (trackerData.data && trackerData.data.token) || 
                           (trackerData.data && trackerData.data.tracker) || 
                           trackerData.tracker;
        
        if (!trackerToken) {
            console.error('Safepay response missing token:', trackerData);
            return res.status(500).json({ success: false, message: 'Safepay response missing token' });
        }

        // 2. Create Pending Order in DB
        const order = new KeyOrder({
            shopkeeper: req.user._id,
            platform: platform || 'android',
            numKeys,
            unitPrice: unitPrice,
            totalAmount,
            paymentProofImage: `SAFEPAY_PENDING_${trackerToken}`,
            status: 'Pending',
            trackerId: trackerToken
        });
        await order.save();

        // 3. Construct Checkout URL with Deep Linking
        // pklocker://payment-result is handled in Android Manifest
        const successUrl = `pklocker://payment-result?status=success&orderId=${order._id}`;
        const cancelUrl = `pklocker://payment-result?status=cancelled&orderId=${order._id}`;

        const env = process.env.SAFEPAY_PRODUCTION === 'true' ? 'production' : 'sandbox';
        // Note: view=mobile and source=mobile help in showing mobile wallets like EasyPaisa/JazzCash
        const finalUrl = `${checkoutUrlBase}?tracker=${trackerToken}&beacon=${trackerToken}&env=${env}&source=mobile&view=mobile&order_id=${order._id}&amount=${totalAmount}&currency=PKR&success_url=${encodeURIComponent(successUrl)}&cancel_url=${encodeURIComponent(cancelUrl)}`;

        res.json({
            success: true,
            data: {
                checkoutUrl: finalUrl,
                tracker: trackerToken,
                orderId: order._id,
                amount: totalAmount
            }
        });

    } catch (err) {
        console.error('Safepay tracker creation error:', err);
        res.status(500).json({ success: false, message: 'Internal server error during payment initialization' });
    }
});

// POST /api/key-orders/safepay/webhook
// Step 2: Handle SERVER-TO-SERVER payment notification (Most Reliable)
router.post('/safepay/webhook', async (req, res) => {
    try {
        const { tracker, order_id, status } = req.body;
        // In Production: Handle X-SFPY-SIGNATURE verification here using SAFEPAY_WEBHOOK_SECRET

        if (status === 'success') {
            const order = await KeyOrder.findById(order_id);
            if (order && order.status === 'Pending') {
                order.status = 'Approved';
                await order.save();
                await allocateKeysToShopkeeper(order.shopkeeper, order.numKeys, order.platform);
                console.log(`[Webhook] Order ${order_id} fulfilled.`);
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error('Safepay webhook error:', err);
        res.status(500).send('Webhook error');
    }
});

// POST /api/key-orders/free-test-keys
// Allows shopkeepers to get up to 10 keys for free for testing
router.post('/free-test-keys', protect, async (req, res) => {
    try {
        const { numKeys, platform } = req.body;
        const keysToAdd = parseInt(numKeys) || 0;

        if (keysToAdd <= 0 || keysToAdd > 10) {
            return res.status(400).json({ success: false, message: 'Max 10 keys allowed for free test' });
        }

        // Create the Approved Order
        const order = new KeyOrder({
            shopkeeper: req.user._id,
            platform: platform || 'android',
            numKeys: keysToAdd,
            unitPrice: 0,
            totalAmount: 0,
            paymentProofImage: 'FREE_TEST_ALLOCATION',
            status: 'Approved'
        });
        await order.save();

        // Allocate keys
        const updatedKeys = await allocateKeysToShopkeeper(req.user._id, keysToAdd, platform || 'android');

        res.json({
            success: true,
            message: `${keysToAdd} test keys added successfully!`,
            availableKeys: (updatedKeys.totalKeys - updatedKeys.usedKeys)
        });
    } catch (err) {
        console.error('Free keys error:', err);
        res.status(500).json({ success: false, message: 'Failed to allocate test keys' });
    }
});
// Step 3: Manual status check from App
router.post('/verify-safepay', protect, async (req, res) => {
    try {
        const { tracker, orderId } = req.body;
        
        // Find order by tracker or ID
        const query = orderId ? { _id: orderId } : { trackerId: tracker };
        const order = await KeyOrder.findOne(query);
        
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        
        if (order.status === 'Approved') {
            return res.json({ success: true, message: 'Payment successfully processed!' });
        }

        res.json({ 
            success: false, 
            message: 'Payment verification still pending...',
            status: order.status 
        });

    } catch (err) {
        console.error('Safepay verification error:', err);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

// POST /api/key-orders/request
// Manual request for keys with screenshot proof
router.post('/request', protect, async (req, res) => {
    try {
        const { numKeys, paymentProofImage, platform } = req.body;

        if (!numKeys || !paymentProofImage) {
            return res.status(400).json({ success: false, message: 'Number of keys and payment proof required' });
        }

        const unitPrice = getDynamicPrice(numKeys);
        const totalAmount = numKeys * unitPrice;

        const order = new KeyOrder({
            shopkeeper: req.user._id,
            platform: platform || 'android',
            numKeys,
            unitPrice,
            totalAmount,
            paymentProofImage,
            status: 'Pending'
        });

        await order.save();

        res.status(201).json({
            success: true,
            message: 'Order submitted! Please wait for administrative approval.',
            orderId: order._id
        });
    } catch (err) {
        console.error('Key request error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/key-orders/history
router.get('/history', protect, async (req, res) => {
    try {
        const history = await KeyOrder.find({ shopkeeper: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, count: history.length, data: history });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;

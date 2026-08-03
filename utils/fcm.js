const admin = require('firebase-admin');

const sendFCM = async (fcmToken, data) => {
    if (!fcmToken) {
        console.warn('Cannot send FCM: No token found for device.');
        return;
    }
    try {
        console.log(`[FCM] Sending command: ${data.command} to target: ${data.target} (State: ${data.state})`);
        console.log(`[FCM] Using Token: ${fcmToken.substring(0, 10)}...${fcmToken.substring(fcmToken.length - 10)}`);
        const response = await admin.messaging().send({
            data,
            token: fcmToken,
            android: {
                priority: 'high'
            }
        });
        console.log(`[FCM] Success: Message sent (ID: ${response})`);
    } catch (err) {
        console.error(`[FCM] Error sending message: ${err.message}`);
    }
};


module.exports = { sendFCM };

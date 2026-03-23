const mongoose = require('mongoose');
const Device = require('./models/Device');

async function run() {
    try {
        await mongoose.connect('mongodb+srv://auto-wheel-apps:AutoWheels123@auto-wheels.m4wrf.mongodb.net/pklocker');
        const dev = await Device.findOne({ "alerts.type": "EMI_WARNING" }).sort({ "alerts.timestamp": -1 });
        if (dev) {
            console.log("Device found with EMI_WARNING:");
            console.log("IMEI:", dev.imei);
            console.log("Controls Object:", dev.controls);
            console.log("Latest Alert:", dev.alerts[dev.alerts.length - 1]);
        } else {
            console.log("No device has received an EMI warning yet.");
        }
    } catch(e) {
        console.error(e);
    } finally {
        mongoose.disconnect();
    }
}
run();

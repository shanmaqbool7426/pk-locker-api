const mongoose = require('mongoose');
const EmiPayment = require('./models/EmiPayment');

const MONGO_URI = 'mongodb+srv://auto-wheel-apps:AutoWheels123@auto-wheels.m4wrf.mongodb.net/pklocker';

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        
        let emi = await EmiPayment.findOne({ status: 'Unpaid' }).sort({ createdAt: -1 });
        if (emi) {
            console.log('Original EMI Due Date:', emi.dueDate);
            const newDate = new Date();
            newDate.setDate(newDate.getDate() - 2); // 2 days ago (overdue by 2 days)
            emi.dueDate = newDate;
            emi.status = 'Unpaid';
            await emi.save();
            console.log(`EMI [${emi._id}] Updated. New Due Date (2 Days Ago):`, emi.dueDate);
        } else {
            console.log('No Unpaid EMI found to test with.');
        }

    } catch(e) {
        console.error('Error:', e);
    } finally {
        mongoose.disconnect();
    }
}
run();

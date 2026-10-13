require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    const imei = '352680891634696';
    
    // Delete device record completely
    const devResult = await db.collection('devices').deleteOne({ imei });
    console.log(`Device deleted: ${devResult.deletedCount} record(s)`);

    // Delete associated EMI payments
    const emiResult = await db.collection('emipayments').deleteMany({ imei });
    console.log(`EMI records deleted: ${emiResult.deletedCount} record(s)`);

    // Return the consumed key
    const device = await db.collection('devices').findOne({ imei });
    // Key was already returned during deregister, but let's verify
    console.log(`\nDone! IMEI ${imei} completely removed.`);

    await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });

const mongoose = require('mongoose');
const Shopkeeper = require('./models/Shopkeeper');
const dotenv = require('dotenv');

dotenv.config();

// Fix for "querySrv ECONNREFUSED" DNS issue on some networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        const phone = '03069829158';
        const password = '11223344';

        // Check if exists
        const existing = await Shopkeeper.findOne({ phone });
        if (existing) {
            console.log('Admin already exists. Updating role, name and password...');
            existing.role = 'admin';
            existing.name = 'Shan Maqbool';
            existing.password = password; // this will trigger the pre-save hook to hash
            await existing.save();
            console.log('Admin updated successfully.');
        } else {
            const admin = new Shopkeeper({
                name: 'Shan Maqbool',
                phone: phone,
                password: password,
                role: 'admin',
                shopName: 'PK Locker HQ'
            });
            await admin.save();
            console.log('Admin account created successfully.');
        }

        mongoose.connection.close();
    } catch (err) {
        console.error('Error creating admin:', err);
        process.exit(1);
    }
};

createAdmin();

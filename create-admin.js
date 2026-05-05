const mongoose = require('mongoose');
const Shopkeeper = require('./models/Shopkeeper');
const dotenv = require('dotenv');

dotenv.config();

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        const phone = '03069829158';
        const password = 'Shan7426@';

        // Check if exists
        const existing = await Shopkeeper.findOne({ phone });
        if (existing) {
            console.log('Admin already exists. Updating role and password...');
            existing.role = 'admin';
            existing.password = password; // this will trigger the pre-save hook to hash
            await existing.save();
            console.log('Admin updated successfully.');
        } else {
            const admin = new Shopkeeper({
                name: 'Shan Maqbool (Admin)',
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

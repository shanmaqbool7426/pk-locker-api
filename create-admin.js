const mongoose = require('mongoose');
const Shopkeeper = require('./models/Shopkeeper');
const dotenv = require('dotenv');

dotenv.config();

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        const email = 'shan@mailinator.com';
        const password = 'password123';

        // Check if exists
        const existing = await Shopkeeper.findOne({ email });
        if (existing) {
            console.log('Admin already exists. Updating role to admin...');
            existing.role = 'admin';
            await existing.save();
            console.log('Admin updated successfully.');
        } else {
            const admin = new Shopkeeper({
                name: 'Shan Maqbool',
                email: email,
                password: password,
                role: 'admin',
                shopName: 'PK locker HQ'
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

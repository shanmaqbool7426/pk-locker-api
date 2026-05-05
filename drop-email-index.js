const mongoose = require('mongoose');
require('dotenv').config();

const dropIndex = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        
        const db = mongoose.connection.db;
        
        // Try to drop the email_1 index
        try {
            await db.collection('shopkeepers').dropIndex('email_1');
            console.log('Successfully dropped the email_1 index from shopkeepers collection.');
        } catch (e) {
            console.log('Index email_1 might not exist or already dropped:', e.message);
        }

        mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
};

dropIndex();

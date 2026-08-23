const ImageKit = require('imagekit');

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

/**
 * Upload base64 image to ImageKit
 * @param {string} base64String 
 * @param {string} fileName 
 * @param {string} folder 
 * @returns {Promise<string>} - The URL of the uploaded image
 */
const uploadImage = async (base64String, fileName, folder = 'pklocker') => {
    if (!base64String) return null;
    
    // If it's already a URL, return it
    if (base64String.startsWith('http')) return base64String;

    try {
        // Race the upload against a 30s timeout to prevent hanging
        const uploadPromise = imagekit.upload({
            file: base64String, // base64 string
            fileName: fileName || `img_${Date.now()}`,
            folder: folder
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('ImageKit upload timed out after 30s')), 30000);
        });

        const response = await Promise.race([uploadPromise, timeoutPromise]);
        return response.url;
    } catch (error) {
        console.error('ImageKit Upload Error:', error.message);
        return null; // Return null so caller can fall back to base64
    }
};

module.exports = { imagekit, uploadImage };

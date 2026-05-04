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
        const response = await imagekit.upload({
            file: base64String, // base64 string
            fileName: fileName || `img_${Date.now()}`,
            folder: folder
        });
        return response.url;
    } catch (error) {
        console.error('ImageKit Upload Error:', error);
        return null;
    }
};

module.exports = { imagekit, uploadImage };

const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const security = require('./security');
const logger = require('./logger');

class FileHandler {
    constructor() {
        this.uploadDir = process.env.UPLOAD_PATH || 'uploads';
        this.tempDir = process.env.TEMP_PATH || 'temp';
        this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5MB
        
        // Create directories if they don't exist
        this.initializeDirectories();
        
        // Configure multer storage
        this.storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, this.tempDir);
            },
            filename: (req, file, cb) => {
                cb(null, security.generateSecureFilename(file.originalname));
            }
        });

        // Configure multer upload
        this.upload = multer({
            storage: this.storage,
            limits: {
                fileSize: this.maxFileSize
            },
            fileFilter: this.fileFilter.bind(this)
        });
    }

    // Initialize required directories
    async initializeDirectories() {
        try {
            await fs.mkdir(this.uploadDir, { recursive: true });
            await fs.mkdir(this.tempDir, { recursive: true });
            await fs.mkdir(path.join(this.uploadDir, 'receipts'), { recursive: true });
            await fs.mkdir(path.join(this.uploadDir, 'voice'), { recursive: true });
        } catch (error) {
            logger.error(error, { type: 'directory_initialization_error' });
            throw error;
        }
    }

    // File filter for multer
    fileFilter(req, file, cb) {
        if (!security.isSecureFile(file)) {
            cb(new Error('Invalid file type or size'), false);
            return;
        }
        cb(null, true);
    }

    // Get multer middleware for specific file types
    getUploadMiddleware(type = 'image') {
        switch (type) {
            case 'image':
                return this.upload.single('image');
            case 'voice':
                return this.upload.single('voice');
            case 'multiple':
                return this.upload.array('files', 5);
            default:
                return this.upload.single('file');
        }
    }

    // Process uploaded image
    async processImage(file) {
        try {
            const filename = security.generateSecureFilename(file.originalname);
            const outputPath = path.join(this.uploadDir, 'receipts', filename);

            // Process image with sharp
            await sharp(file.path)
                .resize(1200, 1200, { // Max dimensions
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 80 }) // Convert to JPEG and compress
                .toFile(outputPath);

            // Delete temporary file
            await fs.unlink(file.path);

            return {
                filename,
                path: outputPath,
                url: `/uploads/receipts/${filename}`
            };
        } catch (error) {
            logger.error(error, { type: 'image_processing_error' });
            throw error;
        }
    }

    // Extract text from receipt image using OCR
    async extractTextFromReceipt(imagePath) {
        try {
            const worker = await createWorker('ind'); // Indonesian language

            try {
                const { data: { text } } = await worker.recognize(imagePath);
                await worker.terminate();

                // Process extracted text
                const processedText = this.processReceiptText(text);

                return {
                    success: true,
                    text: processedText
                };
            } catch (error) {
                await worker.terminate();
                throw error;
            }
        } catch (error) {
            logger.error(error, { type: 'ocr_error' });
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Process extracted receipt text
    processReceiptText(text) {
        // Remove unnecessary whitespace
        text = text.replace(/\s+/g, ' ').trim();

        // Extract amount
        const amountMatch = text.match(/(?:Rp|IDR)\s*[\d.,]+/i);
        const amount = amountMatch ? amountMatch[0] : null;

        // Extract date
        const dateMatch = text.match(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/);
        const date = dateMatch ? dateMatch[0] : null;

        // Extract merchant name (usually at the top of receipt)
        const lines = text.split('\n');
        const merchant = lines[0]?.trim() || null;

        return {
            fullText: text,
            extracted: {
                amount,
                date,
                merchant
            }
        };
    }

    // Handle voice message
    async processVoice(file) {
        try {
            const filename = security.generateSecureFilename(file.originalname);
            const outputPath = path.join(this.uploadDir, 'voice', filename);

            // Move file from temp to voice directory
            await fs.rename(file.path, outputPath);

            return {
                filename,
                path: outputPath,
                url: `/uploads/voice/${filename}`
            };
        } catch (error) {
            logger.error(error, { type: 'voice_processing_error' });
            throw error;
        }
    }

    // Delete file
    async deleteFile(filepath) {
        try {
            await fs.unlink(filepath);
            return true;
        } catch (error) {
            logger.error(error, { type: 'file_deletion_error' });
            return false;
        }
    }

    // Clean up temporary files
    async cleanupTemp() {
        try {
            const files = await fs.readdir(this.tempDir);
            
            for (const file of files) {
                const filepath = path.join(this.tempDir, file);
                const stats = await fs.stat(filepath);
                
                // Delete files older than 1 hour
                if (Date.now() - stats.mtime.getTime() > 3600000) {
                    await fs.unlink(filepath);
                }
            }
        } catch (error) {
            logger.error(error, { type: 'temp_cleanup_error' });
        }
    }

    // Get file stats
    async getFileStats() {
        try {
            const stats = {
                receipts: { count: 0, size: 0 },
                voice: { count: 0, size: 0 },
                temp: { count: 0, size: 0 }
            };

            // Get receipt stats
            const receiptFiles = await fs.readdir(path.join(this.uploadDir, 'receipts'));
            for (const file of receiptFiles) {
                const filepath = path.join(this.uploadDir, 'receipts', file);
                const fileStats = await fs.stat(filepath);
                stats.receipts.count++;
                stats.receipts.size += fileStats.size;
            }

            // Get voice stats
            const voiceFiles = await fs.readdir(path.join(this.uploadDir, 'voice'));
            for (const file of voiceFiles) {
                const filepath = path.join(this.uploadDir, 'voice', file);
                const fileStats = await fs.stat(filepath);
                stats.voice.count++;
                stats.voice.size += fileStats.size;
            }

            // Get temp stats
            const tempFiles = await fs.readdir(this.tempDir);
            for (const file of tempFiles) {
                const filepath = path.join(this.tempDir, file);
                const fileStats = await fs.stat(filepath);
                stats.temp.count++;
                stats.temp.size += fileStats.size;
            }

            return stats;
        } catch (error) {
            logger.error(error, { type: 'file_stats_error' });
            throw error;
        }
    }

    // Express middleware for file upload error handling
    handleUploadError() {
        return (error, req, res, next) => {
            if (error instanceof multer.MulterError) {
                if (error.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        success: false,
                        message: 'File terlalu besar'
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: 'Error saat upload file'
                });
            }

            if (error.message === 'Invalid file type or size') {
                return res.status(400).json({
                    success: false,
                    message: 'Tipe file tidak didukung'
                });
            }

            next(error);
        };
    }
}

module.exports = new FileHandler();

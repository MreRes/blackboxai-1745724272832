const Tesseract = require('tesseract.js');
const { createWorker } = Tesseract;

class OCRProcessor {
    constructor() {
        this.worker = null;
        this.initialized = false;
    }

    async initialize() {
        if (!this.initialized) {
            this.worker = await createWorker('ind');
            await this.worker.loadLanguage('ind');
            await this.worker.initialize('ind');
            this.initialized = true;
        }
    }

    async processImage(imageData) {
        try {
            await this.initialize();
            
            const result = await this.worker.recognize(imageData);
            const text = result.data.text;
            
            // Extract potential transaction data
            const data = {
                amounts: this.extractAmounts(text),
                dates: this.extractDates(text),
                merchants: this.extractMerchants(text),
                items: this.extractItems(text)
            };

            return {
                success: true,
                rawText: text,
                extractedData: data
            };
        } catch (error) {
            console.error('OCR processing error:', error);
            return {
                success: false,
                error: 'Gagal memproses gambar'
            };
        }
    }

    extractAmounts(text) {
        const amounts = [];
        // Match common Indonesian currency patterns
        const patterns = [
            /Rp\.?\s*\d+[\d.,]*\d*/g,  // Rp 50.000 or Rp.50.000
            /IDR\s*\d+[\d.,]*\d*/g,     // IDR 50.000
            /\d+[\d.,]*\d*,-$/gm,       // 50.000,-
            /\d+[\d.,]*\d*,00/g         // 50.000,00
        ];

        patterns.forEach(pattern => {
            const matches = text.match(pattern) || [];
            matches.forEach(match => {
                // Clean up and convert to number
                const amount = match.replace(/[Rp.,\s]/g, '');
                if (!isNaN(amount)) {
                    amounts.push(parseFloat(amount));
                }
            });
        });

        return amounts;
    }

    extractDates(text) {
        const dates = [];
        // Match common Indonesian date patterns
        const patterns = [
            /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g,     // DD-MM-YYYY or DD/MM/YYYY
            /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Ags|Sep|Okt|Nov|Des)[a-z]*\s+\d{2,4}/gi  // DD Month YYYY
        ];

        patterns.forEach(pattern => {
            const matches = text.match(pattern) || [];
            matches.forEach(match => {
                try {
                    const date = new Date(match);
                    if (!isNaN(date.getTime())) {
                        dates.push(date.toISOString());
                    }
                } catch (e) {
                    // Invalid date format, skip
                }
            });
        });

        return dates;
    }

    extractMerchants(text) {
        const merchants = [];
        // Common merchant indicators in Indonesian receipts
        const patterns = [
            /(?:TOKO|RESTO|RESTAURANT|WARUNG|CAFE|KEDAI|PT\.|CV\.)\s+([A-Z\s]+)/gi,
            /^([A-Z\s]{3,})\s*(?:RECEIPT|STRUK|NOTA)/gim
        ];

        patterns.forEach(pattern => {
            const matches = text.match(pattern) || [];
            matches.forEach(match => {
                merchants.push(match.trim());
            });
        });

        return merchants;
    }

    extractItems(text) {
        const items = [];
        // Match common item patterns in Indonesian receipts
        // Usually items are listed with quantity and price
        const lines = text.split('\n');
        
        lines.forEach(line => {
            // Look for lines with quantity and price patterns
            if (/\d+\s*x\s*[\d.,]+/.test(line) || /Rp\.?\s*\d+[\d.,]*\d*/.test(line)) {
                // Clean up the line
                const cleanLine = line.trim()
                    .replace(/^\d+\s*x\s*/, '')  // Remove quantity
                    .replace(/Rp\.?\s*\d+[\d.,]*\d*/, '')  // Remove price
                    .trim();
                
                if (cleanLine.length > 2) {  // Avoid too short strings
                    items.push(cleanLine);
                }
            }
        });

        return items;
    }

    async terminate() {
        if (this.worker && this.initialized) {
            await this.worker.terminate();
            this.initialized = false;
        }
    }
}

module.exports = new OCRProcessor();

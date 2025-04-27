const { NlpManager } = require('node-nlp');
const moment = require('moment');
moment.locale('id');

class FinancialNLP {
    constructor() {
        this.manager = new NlpManager({ languages: ['id'], forceNER: true });
        this.initializeManager();
    }

    async initializeManager() {
        // Add documents for intent recognition
        this.addTransactionIntents();
        this.addBudgetIntents();
        this.addReportIntents();
        this.addGeneralIntents();
        
        // Train the manager
        await this.manager.train();
    }

    addTransactionIntents() {
        // Expense patterns with shortcuts and variations
        this.manager.addDocument('id', 'catat pengeluaran %amount% untuk %category%', 'transaction.expense');
        this.manager.addDocument('id', 'keluar %amount% buat %category%', 'transaction.expense');
        this.manager.addDocument('id', 'bayar %amount% untuk %category%', 'transaction.expense');
        this.manager.addDocument('id', 'beli %category% %amount%', 'transaction.expense');
        this.manager.addDocument('id', 'p%amount% %category%', 'transaction.expense'); // Shortcut
        this.manager.addDocument('id', 'k%amount% %category%', 'transaction.expense'); // Shortcut
        this.manager.addDocument('id', '%amount% untuk %category%', 'transaction.expense');
        
        // Multi-transaction patterns
        this.manager.addDocument('id', 'catat pengeluaran %amount% untuk %category% dan %amount% untuk %category%', 'transaction.expense.multiple');
        this.manager.addDocument('id', 'beli %category% %amount% dan %category% %amount%', 'transaction.expense.multiple');
        
        // Income patterns with shortcuts
        this.manager.addDocument('id', 'catat pemasukan %amount% dari %category%', 'transaction.income');
        this.manager.addDocument('id', 'terima uang %amount% dari %category%', 'transaction.income');
        this.manager.addDocument('id', 'dapat %amount% dari %category%', 'transaction.income');
        this.manager.addDocument('id', 'masuk %amount% dari %category%', 'transaction.income');
        this.manager.addDocument('id', 'm%amount% %category%', 'transaction.income'); // Shortcut
        this.manager.addDocument('id', 'i%amount% %category%', 'transaction.income'); // Shortcut

        // Transaction history with date ranges
        this.manager.addDocument('id', 'lihat transaksi', 'transaction.history');
        this.manager.addDocument('id', 'riwayat transaksi', 'transaction.history');
        this.manager.addDocument('id', 'transaksi bulan ini', 'transaction.history.monthly');
        this.manager.addDocument('id', 'transaksi hari ini', 'transaction.history.daily');
        this.manager.addDocument('id', 'transaksi minggu ini', 'transaction.history.weekly');
        this.manager.addDocument('id', 'transaksi dari %date% sampai %date%', 'transaction.history.range');
        
        // Transaction editing
        this.manager.addDocument('id', 'edit transaksi terakhir', 'transaction.edit.last');
        this.manager.addDocument('id', 'ubah transaksi %category%', 'transaction.edit');
        this.manager.addDocument('id', 'hapus transaksi terakhir', 'transaction.delete.last');
    }

    addBudgetIntents() {
        // Budget management
        this.manager.addDocument('id', 'atur budget %amount% untuk %category%', 'budget.set');
        this.manager.addDocument('id', 'set budget %category% %amount%', 'budget.set');
        this.manager.addDocument('id', 'lihat budget', 'budget.view');
        this.manager.addDocument('id', 'sisa budget', 'budget.remaining');
    }

    addReportIntents() {
        // Report requests
        this.manager.addDocument('id', 'laporan keuangan', 'report.general');
        this.manager.addDocument('id', 'laporan bulanan', 'report.monthly');
        this.manager.addDocument('id', 'laporan harian', 'report.daily');
        this.manager.addDocument('id', 'analisa pengeluaran', 'report.expense.analysis');
    }

    addGeneralIntents() {
        // Help and general queries
        this.manager.addDocument('id', 'bantuan', 'general.help');
        this.manager.addDocument('id', 'cara pakai', 'general.help');
        this.manager.addDocument('id', 'menu', 'general.menu');
        this.manager.addDocument('id', 'status', 'general.status');
    }

    async processMessage(message) {
        try {
            const result = await this.manager.process('id', message);
            return this.extractFinancialData(result);
        } catch (error) {
            console.error('Error processing message:', error);
            return {
                intent: 'error',
                error: 'Maaf, terjadi kesalahan dalam memproses pesan Anda.'
            };
        }
    }

    extractFinancialData(nlpResult) {
        const data = {
            intent: nlpResult.intent,
            confidence: nlpResult.score,
            entities: {},
            originalText: nlpResult.utterance
        };

        // Extract amount
        const amountEntity = nlpResult.entities.find(e => e.entity === 'amount');
        if (amountEntity) {
            data.entities.amount = this.normalizeAmount(amountEntity.utterance);
        }

        // Extract category
        const categoryEntity = nlpResult.entities.find(e => e.entity === 'category');
        if (categoryEntity) {
            data.entities.category = this.normalizeCategory(categoryEntity.utterance);
        }

        // Extract date if present
        const dateEntity = nlpResult.entities.find(e => e.entity === 'date');
        if (dateEntity) {
            data.entities.date = this.normalizeDate(dateEntity.utterance);
        }

        return data;
    }

    normalizeAmount(amountStr) {
        // Handle shortcuts (k = ribu, m = juta, b = milyar)
        const shortcuts = {
            'k': 1000,
            'm': 1000000,
            'b': 1000000000
        };

        // Check for shortcuts
        for (const [key, multiplier] of Object.entries(shortcuts)) {
            if (amountStr.toLowerCase().includes(key)) {
                const number = parseFloat(amountStr.toLowerCase().replace(key, ''));
                return number * multiplier;
            }
        }

        // Remove currency symbols and separators
        let normalized = amountStr.replace(/[Rp.,]/g, '');

        // Extended word-to-number conversion
        const wordToNumber = {
            'nol': 0, 'satu': 1, 'dua': 2, 'tiga': 3, 'empat': 4, 'lima': 5,
            'enam': 6, 'tujuh': 7, 'delapan': 8, 'sembilan': 9, 'sepuluh': 10,
            'sebelas': 11, 'duabelas': 12, 'tigabelas': 13, 'empatbelas': 14,
            'limabelas': 15, 'enambelas': 16, 'tujuhbelas': 17, 'delapanbelas': 18,
            'sembilanbelas': 19, 'duapuluh': 20, 'tigapuluh': 30, 'empatpuluh': 40,
            'limapuluh': 50, 'enampuluh': 60, 'tujuhpuluh': 70, 'delapanpuluh': 80,
            'sembilanpuluh': 90, 'seratus': 100, 'seribu': 1000,
            'ribu': 1000, 'juta': 1000000, 'milyar': 1000000000
        };

        // Handle word-based amounts
        if (isNaN(normalized)) {
            let words = normalized.toLowerCase().split(' ');
            let total = 0;
            let current = 0;

            words.forEach(word => {
                if (wordToNumber[word]) {
                    if (wordToNumber[word] >= 1000) {
                        current = current * wordToNumber[word];
                        total += current;
                        current = 0;
                    } else {
                        current += wordToNumber[word];
                    }
                }
            });

            return total + current;
        }

        return parseFloat(normalized);
    }

    normalizeCategory(category) {
        const categoryMap = {
            // Food & Beverage
            'makan': 'makanan', 'minum': 'makanan', 'food': 'makanan', 'snack': 'makanan',
            'sarapan': 'makanan', 'mcd': 'makanan', 'kfc': 'makanan', 'resto': 'makanan',
            
            // Transportation
            'transport': 'transportasi', 'bensin': 'transportasi', 'bbm': 'transportasi',
            'grab': 'transportasi', 'gojek': 'transportasi', 'taxi': 'transportasi',
            'tol': 'transportasi', 'parkir': 'transportasi', 'busway': 'transportasi',
            
            // Communication
            'pulsa': 'komunikasi', 'internet': 'komunikasi', 'data': 'komunikasi',
            'wifi': 'komunikasi', 'telepon': 'komunikasi', 'kuota': 'komunikasi',
            
            // Utilities
            'listrik': 'utilitas', 'air': 'utilitas', 'pln': 'utilitas', 'pdam': 'utilitas',
            'gas': 'utilitas', 'sampah': 'utilitas', 'maintenance': 'utilitas',
            
            // Shopping
            'belanja': 'shopping', 'baju': 'shopping', 'sepatu': 'shopping',
            'tas': 'shopping', 'aksesoris': 'shopping', 'mall': 'shopping',
            
            // Income
            'gaji': 'pendapatan', 'salary': 'pendapatan', 'bonus': 'pendapatan',
            'freelance': 'pendapatan', 'proyek': 'pendapatan', 'investasi': 'pendapatan',
            'dividen': 'pendapatan', 'bunga': 'pendapatan'
        };

        // Use fuzzy matching for category recognition
        const normalized = category.toLowerCase().trim();
        if (categoryMap[normalized]) return categoryMap[normalized];

        // Find closest match if exact match not found
        const categories = Object.keys(categoryMap);
        const closest = categories.reduce((best, current) => {
            const distance = this.levenshteinDistance(normalized, current);
            return distance < best.distance ? { category: current, distance } : best;
        }, { category: normalized, distance: Infinity });

        return closest.distance <= 2 ? categoryMap[closest.category] : normalized;
    }

    levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(
                        dp[i - 1][j],     // deletion
                        dp[i][j - 1],     // insertion
                        dp[i - 1][j - 1]  // substitution
                    );
                }
            }
        }
        return dp[m][n];
    }

    normalizeDate(dateStr) {
        // Handle various date formats and convert to ISO string
        const formats = [
            'DD-MM-YYYY', 'D MMM YYYY', 'YYYY-MM-DD',
            'DD/MM/YYYY', 'D/M/YYYY', 'YYYY/MM/DD',
            'DD MMM YYYY', 'D MMMM YYYY',
            'hari ini', 'kemarin', 'besok'
        ];

        if (dateStr === 'hari ini') {
            return moment().toISOString();
        } else if (dateStr === 'kemarin') {
            return moment().subtract(1, 'days').toISOString();
        } else if (dateStr === 'besok') {
            return moment().add(1, 'days').toISOString();
        }

        return moment(dateStr, formats).toISOString();
    }

    async processMultipleTransactions(text) {
        const transactions = [];
        const parts = text.split(' dan ');
        
        for (const part of parts) {
            const result = await this.manager.process('id', part);
            const data = this.extractFinancialData(result);
            if (data.entities.amount && data.entities.category) {
                transactions.push(data);
            }
        }
        
        return transactions;
    }

    generateResponse(processedData) {
        const responses = {
            'transaction.expense': (data) => 
                `Pengeluaran sebesar Rp${data.entities.amount.toLocaleString('id')} untuk ${data.entities.category} telah dicatat.`,
            'transaction.income': (data) => 
                `Pemasukan sebesar Rp${data.entities.amount.toLocaleString('id')} dari ${data.entities.category} telah dicatat.`,
            'budget.set': (data) => 
                `Budget untuk ${data.entities.category} telah diatur sebesar Rp${data.entities.amount.toLocaleString('id')}.`,
            'transaction.expense.multiple': (data) => {
                if (!data.transactions) return 'Terjadi kesalahan dalam memproses transaksi ganda.';
                return data.transactions.map(t => 
                    `Pengeluaran sebesar Rp${t.entities.amount.toLocaleString('id')} untuk ${t.entities.category}`
                ).join('\n') + '\nSemua transaksi telah dicatat.';
            },
            'transaction.edit.last': () => 
                'Silakan masukkan detail baru untuk transaksi terakhir.',
            'transaction.delete.last': () => 
                'Transaksi terakhir telah dihapus.',
            'error': (data) => 
                data.error || 'Maaf, saya tidak dapat memproses permintaan Anda. Ketik "bantuan" untuk panduan.'
        };

        return responses[processedData.intent]?.(processedData) || 
               'Maaf, saya tidak mengerti permintaan Anda. Ketik "bantuan" untuk melihat panduan penggunaan.';
    }
}

module.exports = new FinancialNLP();

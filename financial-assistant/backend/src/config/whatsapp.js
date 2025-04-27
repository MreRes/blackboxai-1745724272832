const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const EventEmitter = require('events');

class WhatsAppBot extends EventEmitter {
    constructor() {
        super();
        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: "financial-assistant" }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            }
        });

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.client.on('qr', (qr) => {
            qrcode.generate(qr, { small: true });
            this.emit('qr', qr);
        });

        this.client.on('ready', () => {
            console.log('WhatsApp client is ready!');
            this.emit('ready');
        });

        this.client.on('message', async (msg) => {
            try {
                if (msg.body.toLowerCase().startsWith('daftar')) {
                    await this.handleRegistration(msg);
                } else if (msg.body.toLowerCase().startsWith('aktivasi')) {
                    await this.handleActivation(msg);
                } else if (msg.body.toLowerCase().includes('catat')) {
                    await this.handleTransaction(msg);
                } else {
                    await this.handleNaturalLanguage(msg);
                }
            } catch (error) {
                console.error('Error handling message:', error);
                await this.sendMessage(msg.from, 'Maaf, terjadi kesalahan. Silakan coba lagi.');
            }
        });

        this.client.on('disconnected', (reason) => {
            console.log('Client was disconnected', reason);
            this.emit('disconnected', reason);
        });
    }

    async handleRegistration(msg) {
        // TODO: Implement user registration logic
        await this.sendMessage(msg.from, 'Terima kasih telah mendaftar. Admin akan memproses pendaftaran Anda.');
    }

    async handleActivation(msg) {
        // TODO: Implement activation code verification
        const code = msg.body.split(' ')[1];
        if (!code) {
            await this.sendMessage(msg.from, 'Format salah. Gunakan: aktivasi <kode>');
            return;
        }
        // Verify activation code logic here
    }

    async handleTransaction(msg) {
        // TODO: Implement transaction processing
        const text = msg.body.toLowerCase();
        if (text.includes('pengeluaran')) {
            // Handle expense
        } else if (text.includes('pemasukan')) {
            // Handle income
        }
    }

    async handleNaturalLanguage(msg) {
        // TODO: Implement NLP processing
        console.log('Processing message:', msg.body);
    }

    async sendMessage(to, message) {
        try {
            await this.client.sendMessage(to, message);
            return true;
        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    }

    initialize() {
        this.client.initialize();
    }
}

module.exports = new WhatsAppBot();

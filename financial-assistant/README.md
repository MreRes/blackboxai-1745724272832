# WhatsApp Financial Assistant

Sistem pencatatan, pengelolaan, dan analisa keuangan pribadi berbasis WhatsApp Bot dan dashboard web.

## Fitur Utama

### WhatsApp Bot
- Pencatatan transaksi (teks, voice, image/receipt OCR)
- Edit, hapus, filter transaksi
- Lihat riwayat transaksi (periode, sumber)
- Atur & pantau budget
- Analisa laporan keuangan (harian, bulanan, tahunan)
- NLP tingkat lanjut (slang, typo, context, sentiment)
- Voice-to-text, image-to-text (OCR)

### Dashboard User
- Login dengan username + kode aktivasi
- Dashboard interaktif
- Riwayat transaksi (CRUD, filter)
- Budget management
- Laporan keuangan
- Dark mode

### Dashboard Admin
- Manajemen user & aktivasi
- Monitoring transaksi
- Pengaturan sistem
- Backup/restore database
- Audit log

## Teknologi

- Backend: Node.js, Express, MongoDB
- WhatsApp Bot: whatsapp-web.js
- NLP: node-nlp
- Frontend: HTML, Tailwind CSS, JavaScript
- Security: JWT, bcrypt

## Instalasi

1. Clone repository:
```bash
git clone https://github.com/yourusername/financial-assistant.git
cd financial-assistant
```

2. Install dependencies:
```bash
cd backend
npm install
```

3. Setup environment variables:
- Copy `.env.example` ke `.env`
- Sesuaikan konfigurasi database dan JWT secret

4. Jalankan server:
```bash
npm start
```

## Penggunaan WhatsApp Bot

### Registrasi & Aktivasi
1. Kirim pesan "Daftar" ke bot
2. Admin akan membuatkan user dan kode aktivasi
3. Aktivasi dengan format: "Aktivasi [username] [kode]"

### Format Pesan
- Catat pengeluaran: "catat pengeluaran [jumlah] untuk [kategori]"
- Catat pemasukan: "catat pemasukan [jumlah] dari [kategori]"
- Lihat transaksi: "lihat transaksi"
- Lihat budget: "lihat budget"
- Laporan: "laporan [harian/bulanan/tahunan]"

### Fitur NLP
Bot memahami berbagai variasi bahasa:
- Formal: "catat pengeluaran 50000 untuk makan"
- Informal: "keluar 50rb buat makan"
- Slang: "beli makan 50k"

## API Endpoints

### Auth
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/admin/login

### Transactions
- GET /api/transactions
- POST /api/transactions
- PUT /api/transactions/:id
- DELETE /api/transactions/:id

### Budget
- GET /api/budgets
- POST /api/budgets
- PUT /api/budgets/:id

### Admin
- GET /api/admin/users
- PUT /api/admin/users/:id
- POST /api/admin/backup
- POST /api/admin/restore

## Keamanan

- Enkripsi password & kode aktivasi
- Rate limiting
- JWT authentication
- Session management
- Input validation
- Error handling
- Audit logging

## Backup & Restore

### Backup Manual
```bash
curl -X POST http://localhost:3000/api/admin/backup \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Restore dari Backup
```bash
curl -X POST http://localhost:3000/api/admin/restore \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"timestamp": "BACKUP_TIMESTAMP"}'
```

## Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Statistik Admin
```bash
curl http://localhost:3000/api/admin/statistics \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## Pengembangan

### Struktur Proyek
```
financial-assistant/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── handlers/
│   │   └── utils/
│   └── package.json
├── frontend/
│   ├── user-dashboard/
│   └── admin-dashboard/
└── README.md
```

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```

## Kontribusi

1. Fork repository
2. Buat branch fitur (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

## Lisensi

Distributed under the MIT License. See `LICENSE` for more information.

## Kontak

Your Name - [@yourusername](https://twitter.com/yourusername)

Project Link: [https://github.com/yourusername/financial-assistant](https://github.com/yourusername/financial-assistant)

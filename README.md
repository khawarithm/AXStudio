# AXStudio — PDF Toolkit PWA

Progressive Web App untuk viewing, editing, export, OCR, dan printing PDF.
Dibangun dengan **HTML, CSS, Vanilla JavaScript (ES6 modules)** — tanpa
framework — mengikuti **Material Design 3**, dan siap di-deploy ke GitHub
Pages atau Vercel.

## Menjalankan secara lokal

Karena app menggunakan ES6 modules (`type="module"`) dan Service Worker,
buka lewat local web server (bukan `file://`):

```bash
cd axstudio
python3 -m http.server 8080
# lalu buka http://localhost:8080
```

Atau dengan Node:
```bash
npx serve axstudio
```

## Deploy

### GitHub Pages
1. Push folder `axstudio/` sebagai root repo (atau branch `gh-pages`).
2. Aktifkan GitHub Pages di Settings → Pages → pilih branch/folder.
3. Selesai — PWA otomatis installable di URL yang dihasilkan.

### Vercel
1. `vercel` atau hubungkan repo lewat dashboard Vercel.
2. Set root directory ke `axstudio/` bila perlu.
3. Tidak ada build step — ini static site murni.

## Struktur Folder

```
axstudio/
├── index.html              # Entry point, seluruh markup UI
├── manifest.json            # Web App Manifest (PWA)
├── service-worker.js        # Offline caching strategy
├── css/
│   ├── tokens.css           # MD3 color/shape/elevation tokens (light+dark)
│   ├── base.css              # Reset & typography
│   ├── layout.css            # App shell, sidebar, bottom nav, responsive
│   ├── components.css        # Buttons, forms, cards, snackbar, dsb.
│   ├── viewer.css            # PDF viewer, thumbnail, search bar
│   ├── dialogs.css           # Modal/dialog styling
│   ├── maker.css             # PDF Maker & preview strip styling
│   ├── editor.css            # Edit PDF canvas/toolbar styling
│   └── animations.css        # Keyframes & transitions
├── js/
│   ├── app.js                # Composition root — bootstrap semua modul
│   ├── modules/               # Logika murni, tidak terikat DOM
│   │   ├── pdfEngine.js        # Wrapper PDF.js: render, zoom, rotate, search
│   │   ├── exporter.js         # Export halaman ke PNG/JPG (+ bundling ZIP)
│   │   ├── textExtractor.js    # Extract teks native + OCR (Tesseract.js)
│   │   ├── pdfUtilities.js     # Merge/split/rotate/delete/compress/dst (pdf-lib)
│   │   ├── pdfMaker.js         # Buat PDF baru dari teks / gambar (pdf-lib)
│   │   ├── pdfEditor.js        # Bake anotasi canvas ke halaman PDF (pdf-lib)
│   │   ├── zipWriter.js        # ZIP writer ringan (dipakai export gambar & DOCX)
│   │   ├── printManager.js     # System print, Bluetooth, USB/OTG printer
│   │   ├── bookmarks.js        # Simpan halaman terakhir & bookmark
│   │   ├── theme.js            # Light/Dark mode
│   │   ├── notifications.js    # Snackbar & loading overlay
│   │   └── utils.js            # Helper umum (page range parser, dll)
│   └── components/             # Pengontrol UI per-view
│       ├── viewerController.js
│       ├── fileLoader.js
│       ├── navigation.js
│       ├── exportPanel.js
│       ├── extractPanel.js
│       ├── utilitiesPanel.js
│       ├── printPanel.js
│       ├── makerPanel.js        # UI "Buat PDF"
│       └── editorPanel.js       # UI "Edit PDF"
├── libs/
│   └── README.md             # Cara switch dari CDN ke library lokal (offline penuh)
└── assets/icons/              # Semua ukuran ikon PWA + favicon
```

## Fitur

- **PDF Viewer**: import (file picker/drag&drop), zoom, rotate, scroll halus,
  thumbnail, cari teks, bookmark halaman terakhir, dark mode, render HD
  (mengikuti device pixel ratio, tajam meski tanpa zoom).
- **Buat PDF**: buat dokumen baru dari teks (word-wrap & pagination otomatis)
  atau dari kumpulan gambar (urutan bisa diatur drag & drop), lengkap dengan
  preview hasil sebelum diunduh atau dibuka di Viewer.
- **Edit PDF**: tambahkan teks (pilih font Helvetica/Times/Courier, bold,
  underline, warna), gambar bebas (pen), kotak, elips, atau sisipan gambar
  (bisa diubah ukurannya) langsung di atas halaman PDF. Tool "Pilih/Geser"
  untuk memindahkan elemen mana pun dengan drag bebas atau tombol arah
  dengan langkah pixel presisi yang bisa diatur. Tombol pintas "Tambah
  Header" untuk judul besar di atas halaman. Semua perubahan diterapkan
  permanen ke dokumen dengan satu klik.
- **Export**: semua halaman / halaman tertentu ke PNG atau JPG, kualitas &
  skala resolusi dapat diatur, preview halaman terpilih tampil otomatis saat
  mengetik nomor/rentang halaman. Saat lebih dari satu halaman diexport,
  hasil dibundel jadi satu file ZIP dengan setiap gambar dinamai sesuai nomor
  halamannya (mis. "1.png", "2.png").
- **Extract Text**: ekstraksi teks native, OCR (Tesseract.js) untuk PDF hasil
  scan, copy ke clipboard, export TXT & DOCX.
- **Printing**: preview sebelum cetak, cetak dari dokumen PDF aktif *atau*
  dari gambar PNG/JPG yang diupload langsung, ukuran kertas (A4/A5/Letter/
  Thermal 58mm/80mm), margin, orientasi, print sistem (juga jalur yang
  dipakai Android Print API lewat dialog cetak browser), printer Bluetooth
  (Web Bluetooth API), printer USB/USB-OTG (WebUSB API).
- **PDF Utilities**: merge, split, rotate halaman, delete halaman, rearrange
  (drag & drop), compress, watermark teks, password protect.
- **PWA**: manifest, service worker, mode offline, installable, splash
  screen, app icon di semua ukuran.
- **UI**: Material Design 3, responsive (sidebar desktop / bottom nav
  mobile), FAB, snackbar, loading indicator, animasi halus.

## Library Eksternal

Dimuat dari CDN (cdnjs) secara default agar langsung jalan tanpa setup:
- **PDF.js** — rendering & parsing PDF
- **pdf-lib** — manipulasi PDF (merge/split/rotate/watermark/dst)
- **Tesseract.js** — OCR untuk PDF hasil scan

Lihat `libs/README.md` untuk instruksi menjalankan 100% offline (tanpa CDN).

## Catatan Teknis

- **Password Protect**: mengandalkan method `encrypt()` pada build pdf-lib
  yang dimuat. Jika versi pdf-lib yang digunakan belum mendukungnya, aplikasi
  akan menampilkan pesan error yang jelas di snackbar.
- **Bluetooth/USB Printer**: menggunakan Web Bluetooth API & WebUSB API —
  hanya tersedia di browser berbasis Chromium (Chrome, Edge, Android Chrome)
  dengan koneksi HTTPS. Cetak mentah ESC/POS lewat jalur ini hanya bekerja
  untuk printer thermal tanpa driver OS bawaan — jika interface printer
  sudah "dimiliki" driver sistem operasi (umum di Windows/macOS/Linux),
  WebUSB tidak bisa mengambil alih koneksinya; paling andal dicoba di
  Android via USB-OTG. Aplikasi sekarang memverifikasi status setiap transfer
  byte dan akan menampilkan pesan error yang jujur (bukan "berhasil" palsu)
  jika transfer benar-benar gagal.
- **Compress PDF**: pdf-lib tidak melakukan re-encode gambar raster, sehingga
  kompresi bekerja lewat optimasi object stream (efektif untuk dokumen hasil
  edit dengan banyak objek redundan). Untuk kompresi gambar agresif, perlu
  library tambahan di luar scope "no-framework, lean deps" pada permintaan ini.
- **Edit PDF — tool "Pilih/Geser"**: klik elemen untuk memilihnya (kotak
  putus-putus biru muncul), lalu geser dengan drag langsung di kanvas atau
  dengan tombol arah + input "langkah (px)" untuk presisi pixel-per-klik.
  Saat teks terpilih, kontrol font/bold/underline/warna di toolbar otomatis
  mengedit elemen tersebut secara langsung; saat tidak ada yang terpilih,
  kontrol yang sama menjadi gaya default untuk elemen berikutnya yang dibuat.
  Gambar yang disisipkan bisa diubah ukurannya lewat input Lebar/Tinggi pada
  toolbar kontekstual yang muncul saat gambar tersebut dipilih.

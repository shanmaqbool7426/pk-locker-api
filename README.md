# 🚀 PK Locker API & Operations Guide

This directory contains the backend API service for **PK Locker** (Vercel Node.js/Express + MongoDB).

---

## 📌 Quick Summary of Operation Steps

### 1. APK Location & Downloads
- **Folder:** `public/apk/`
- **Current Files:** `update.apk` (and `v7_app.apk`)
- **Download Link:** `https://pk-locker-api.vercel.app/apk/update.apk`

---

### 2. Auto-Update API (`/api/version`)
Configured in `index.js`:
- Disabled force-updates by default (`versionCode: 3`, `success: false`).
- To force update all customer devices in production:
  Increase `versionCode` (e.g. to `8`) and set `success: true` in `index.js`.

---

### 3. Customer Phone Setup Steps

1. **Build APK** (in `PKlocker` directory):
   ```cmd
   .\gradlew.bat assembleRelease
   ```
2. **Copy APK** to `locker-api/public/apk/update.apk` and deploy to Vercel/Server.
3. **Provision Phone**:
   - **QR Code Setup:** Tap welcome screen 6 times on factory reset phone -> scan provisioning QR -> Auto-installs APK as Device Owner & auto-fetches IMEI.
   - **Manual Setup:** Download from `https://pk-locker-api.vercel.app/apk/update.apk` -> Grant Device Admin, Overlay (*Display over other apps*), SMS, and Location permissions.
4. **Register Device in Dashboard**:
   - Dial `*#06#` on customer phone for IMEI 1.
   - Go to Admin Portal -> Register device with IMEI 1 & customer EMI plan.
5. **Remote Lock/Unlock**:
   - Click **Lock Device** in Dashboard -> Sends FCM push -> Locks screen.
   - Click **Mark Paid** in Dashboard -> Sends FCM push -> Unlocks screen.

---
*Refer to [PKlocker README](file:///d:/personal-projects/pk-locker/PKlocker/README.md) for full Android app details.*

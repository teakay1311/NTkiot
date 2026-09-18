# Huong dan build tren Windows

Thu muc source copy sang Windows phai co day du cac file sau:

- `package.json`
- `package-lock.json`
- `main.js`
- `index.html`
- `script.js`
- `styles.css`
- `build/icon.ico`

`package-lock.json` mot minh khong du de chay `npm install` hoac `npm run build`.

Khuyen nghi dat thu muc source bang ten khong dau, vi du:

```bat
C:\Users\Admin\Desktop\UNG_DUNG_BAN_HANG_V38_C_HOAN
```

Lenh build tren Windows:

```bat
cd /d C:\Users\Admin\Desktop\UNG_DUNG_BAN_HANG_V38_C_HOAN
dir package.json
type package.json
node -p "require('./package.json').scripts"
npm ci
npm run doctor
npm run build
```

Neu muon build rieng ban cai dat Windows:

```bat
npm run build:win
```

Lenh `npm run build:win` tao ban Windows x64, phu hop voi hau het may Windows.
Neu can rieng Windows ARM64:

```bat
npm run build:win:arm64
```

Luu y:

- Khong copy `node_modules` tu Mac sang Windows.
- Khong chay npm trong thu muc `dist` hoac thu muc chi co `package-lock.json`.
- Neu `npm run doctor` bao thieu file, hay copy lai source day du truoc khi build.

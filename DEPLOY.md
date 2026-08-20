# การ Deploy SmartCtx ผ่าน GitHub ไป Windows Server (เครื่องเดียวกับ SmartPharmacy)

เอกสารนี้สมมติว่า Windows Server เครื่องนี้มี **Node.js, Git, และ PM2 ติดตั้งไว้แล้ว** (เพราะรัน
SmartPharmacy อยู่แล้ว) — ถ้ายังไม่มีตัวใดตัวหนึ่ง ดูหัวข้อ "ถ้ายังไม่เคยติดตั้งอะไรเลย" ท้ายเอกสาร

## ขั้นตอนที่ 0 — พอร์ต (ยืนยันแล้ว ไม่ต้องเดา)

**SmartPharmacy ใช้พอร์ต 3000** — SmartCtx จึงตั้งค่า default ไว้ที่ **พอร์ต 4000** ให้แล้วใน `.env`
และ `.env.example` ที่แนบมา ไม่ชนกันแน่นอน ไม่ต้องแก้อะไรเพิ่มในจุดนี้

ถ้าอยากตรวจสอบซ้ำให้ชัวร์ก่อน deploy จริง (เผื่อมีแอปอื่นแอบใช้พอร์ต 4000 อยู่ก่อนแล้วด้วย) เปิด
PowerShell (Run as Administrator) บน Windows Server แล้วรัน:

```powershell
netstat -ano | findstr :4000
```

ถ้าไม่มีผลลัพธ์อะไรออกมาเลย แปลว่าพอร์ต 4000 ว่าง ใช้ได้เลย — ถ้ามีโปรแกรมอื่นใช้อยู่ก่อนแล้ว (ไม่ใช่
SmartPharmacy) ค่อยเปลี่ยนเป็นพอร์ตอื่นใน `.env` (เช่น 4001) แล้วเช็คซ้ำด้วยคำสั่งเดียวกัน

## ขั้นตอนที่ 1 — เตรียม GitHub repository

**จากเครื่อง dev (เครื่องที่แก้โค้ด ไม่ใช่ Windows Server):**

```bash
cd SmartCtx-v1
git init                                   # ถ้ายังไม่เคยทำ
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-org>/smartctx.git
git push -u origin main
```

`.gitignore` ที่แนบมาด้วยกันไฟล์สำคัญไม่ให้หลุดขึ้น GitHub อยู่แล้ว (`.env` ที่มีรหัสผ่านจริง,
`node_modules/`, ไฟล์ฐานข้อมูล `data/*.db`) — ไม่ต้องแก้อะไรเพิ่ม

## ขั้นตอนที่ 2 — Clone ลง Windows Server (ทำครั้งแรกครั้งเดียว)

เปิด PowerShell หรือ Git Bash บน Windows Server:

```powershell
cd C:\apps                                 # หรือตำแหน่งที่เก็บ SmartPharmacy ไว้ (โฟลเดอร์แยกกันคนละอัน)
git clone https://github.com/<your-org>/smartctx.git
cd smartctx
```

## ขั้นตอนที่ 3 — ติดตั้ง dependencies

```powershell
npm install
```

ถ้า `npm install` ค้างนานผิดปกติที่แพ็กเกจ `sqlite3` (คอมไพล์ native module) — เครื่องต้องมี
Visual Studio Build Tools หรือ `windows-build-tools` ไว้ แต่ปกติถ้า SmartPharmacy รันอยู่แล้วแปลว่า
เครื่องนี้มีเครื่องมือคอมไพล์พร้อมอยู่แล้ว ไม่ต้องติดตั้งซ้ำ

## ขั้นตอนที่ 4 — ตั้งค่า .env (จุดสำคัญที่สุด — เปลี่ยนรหัสผ่าน/secret ทั้งหมด)

```powershell
copy .env.example .env
notepad .env
```

`PORT=4000` ตั้งมาให้ถูกต้องแล้ว (ไม่ชนกับ SmartPharmacy ที่พอร์ต 3000) — จุดที่ต้องแก้จริงๆ คือ:

```
SESSION_SECRET=<สุ่มค่าใหม่>        # ห้ามใช้ค่า placeholder เดิม — สุ่มใหม่ด้วยคำสั่งด้านล่าง
```

สุ่ม `SESSION_SECRET` ใหม่ด้วย:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
คัดลอกผลลัพธ์ไปวางแทนค่าเดิมใน `.env`

ส่วน `PROCUREMENT_USERNAME/PASSWORD`, `ADMIN_USERNAME/PASSWORD`, `SUDO_CLEAR_PASSWORD` — เปลี่ยนรหัสผ่าน
เริ่มต้นทั้งหมดก่อนใช้งานจริงด้วย (ค่าที่แนบมาเป็นค่าเริ่มต้นสำหรับทดสอบเท่านั้น)

## ขั้นตอนที่ 5 — ตัดสินใจเรื่อง HTTP vs HTTPS ก่อนสั่งรัน (สำคัญ)

`server.js` ตั้ง session cookie เป็น `secure: true` เมื่อ `NODE_ENV=production` — ถ้าเสิร์ฟตรงผ่าน HTTP
ธรรมดา (ไม่มี HTTPS) แล้วตั้ง `NODE_ENV=production` จะ **login ไม่ติดเลย** เพราะเบราว์เซอร์ไม่ส่ง cookie
แบบ secure ผ่านการเชื่อมต่อที่ไม่เข้ารหัส

- **ถ้าใช้งานภายในองค์กรผ่าน HTTP ตรงๆ** (เช่น `http://server-ip:4000`) — ปล่อย `NODE_ENV=development`
  ไว้ใน `ecosystem.config.js` ตามที่ตั้งมาให้ (ค่าเริ่มต้นถูกต้องแล้ว ไม่ต้องแก้)
- **ถ้ามี reverse proxy (IIS + ARR, หรือ nginx) ทำ HTTPS ให้ด้านหน้า** — เปลี่ยนเป็น
  `NODE_ENV: 'production'` ใน `ecosystem.config.js` และเพิ่ม `app.set('trust proxy', 1)` ใน `server.js`
  (มีคอมเมนต์เตรียมไว้ให้แล้ว แค่เอา `//` ออก)

## ขั้นตอนที่ 6 — เปิด Windows Firewall ให้พอร์ตที่เลือก (ถ้าจะเข้าถึงจากเครื่องอื่นในเครือข่าย)

```powershell
New-NetFirewallRule -DisplayName "SmartCtx" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```
(เปลี่ยน `4000` ให้ตรงกับพอร์ตที่ตั้งใน `.env`)

## ขั้นตอนที่ 7 — สั่งรันด้วย PM2

```powershell
pm2 start ecosystem.config.js
pm2 save
```

เช็คว่ารันอยู่จริงและไม่ชนกับ SmartPharmacy:
```powershell
pm2 list
```
ควรเห็นทั้ง `smartpharmacy` (หรือชื่อที่ตั้งไว้) และ `smartctx` อยู่ในลิสต์พร้อมกัน สถานะ `online` ทั้งคู่

**หมายเหตุสำหรับ Windows โดยเฉพาะ:** คำสั่ง `pm2 startup` แบบที่ใช้บน Linux (ให้ PM2 เริ่มเองตอนเปิดเครื่อง)
**ใช้ไม่ได้ตรงๆ บน Windows** — ถ้า SmartPharmacy already มีวิธีทำให้ PM2 auto-start ตอนเปิดเครื่องอยู่แล้ว
(เช่นผ่าน `pm2-windows-startup`, NSSM, หรือ Task Scheduler) ให้ใช้กลไกเดียวกันนั้นเพิ่ม SmartCtx เข้าไป
ไม่ต้องตั้งระบบใหม่ซ้ำซ้อน — ถ้ายังไม่เคยตั้งไว้เลย วิธีที่ง่ายที่สุดคือ:
```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

## ขั้นตอนที่ 8 — ทดสอบ

เปิดเบราว์เซอร์ไปที่ `http://<server-ip>:4000` (พอร์ตตามที่ตั้งไว้) ควรเจอหน้าเลือกโมดูล — ลอง login
ทั้ง 2 โมดูลที่ใช้งานได้จริง (งานจัดซื้อ, งานคลังเคมีบำบัด) เพื่อยืนยันว่า session cookie ทำงานถูกต้อง

## การอัปเดตครั้งต่อไป (หลัง deploy ครั้งแรกแล้ว)

```powershell
cd C:\apps\smartctx
git pull
npm install                        # เผื่อมี dependency ใหม่เพิ่มมา
pm2 restart smartctx
```

**ฐานข้อมูล SQLite (`data/*.db`) ไม่ได้อยู่ใน git อยู่แล้ว** — `git pull` จะไม่แตะไฟล์ข้อมูลจริงเลย และ
ระบบ migration อัตโนมัติ (เพิ่มเข้ามาแล้ว) จะเติมคอลัมน์ใหม่ที่ขาดให้เองตอน `pm2 restart` โดยไม่ต้องลบ
ฐานข้อมูลเดิมทิ้ง

## ถ้ายังไม่เคยติดตั้งอะไรเลย (เครื่องใหม่ที่ยังไม่มี SmartPharmacy)

```powershell
# ติดตั้ง Node.js LTS จาก https://nodejs.org ก่อน (ตัวติดตั้ง .msi ธรรมดา) แล้วค่อย:
npm install -g pm2
git --version    # ถ้ายังไม่มี Git ติดตั้งจาก https://git-scm.com/download/win
```
จากนั้นทำตามขั้นตอนที่ 0–8 ด้านบนตามปกติ

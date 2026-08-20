require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

const { createModuleAuth } = require('./core/middleware/moduleAuth.middleware');
const eventBus = require('./modules/_shared/backend/eventBus.util');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer);
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Security headers พื้นฐาน
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

if (!process.env.SESSION_SECRET) {
    console.error('⚠️  ไม่พบ SESSION_SECRET ใน .env — ระบบจะไม่ปลอดภัย กรุณาตั้งค่าก่อนใช้งานจริง');
}

// ถ้ารันหลัง reverse proxy ที่ทำ HTTPS ให้ (เช่น IIS + ARR, nginx) ให้เปิดบรรทัดนี้ เพื่อให้ cookie
// secure ทำงานถูกต้อง (ไม่งั้น Express จะไม่รู้ว่า connection จริงๆ เข้ารหัสอยู่แล้วจาก proxy)
// app.set('trust proxy', 1);

// session cookie อายุ 5 นาที + rolling (ต่ออายุทุกครั้งที่มีการใช้งาน) — คู่กับ popup แจ้งเตือนนับถอยหลัง 30 วิ
// ที่ core/public/js/shared/sessionTimeout.shared.js (auto-logout ทุก session ที่ idle เกิน 5 นาที)
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR, concurrentDB: true }),
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 5 * 60 * 1000
    }
}));

// ---------- Core: theme, session-timeout widget, module picker — ไม่ต้อง login ----------
app.use('/core', express.static(path.join(__dirname, 'core/public')));
app.use('/shared-data', express.static(path.join(__dirname, 'shared-data')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'core/public/index.html')));

// ---------- Module 1.1: งานจัดซื้อ ----------
const procurementAuth = createModuleAuth({
    moduleKey: 'procurement', envUser: 'PROCUREMENT_USERNAME', envPass: 'PROCUREMENT_PASSWORD',
    loginPath: '/modules/procurement/login.html'
});
app.get('/modules/procurement/login.html', (req, res) => res.sendFile(path.join(__dirname, 'modules/procurement/public/login.html')));
app.post('/modules/procurement/api/auth/login', procurementAuth.login);
app.post('/modules/procurement/api/auth/logout', procurementAuth.logout);
app.get('/modules/procurement/api/auth/status', procurementAuth.status);
app.use('/modules/procurement', procurementAuth.requireAuth, express.static(path.join(__dirname, 'modules/procurement/public')));
app.use('/modules/procurement/api', procurementAuth.requireAuth, require('./modules/procurement/backend/procurement.routes'));

// ---------- Module 1.2: งานคลังเคมีบำบัด ----------
const stockAuth = createModuleAuth({
    moduleKey: 'stock-management', envUser: 'ADMIN_USERNAME', envPass: 'ADMIN_PASSWORD',
    loginPath: '/modules/stock-management/login.html'
});
app.get('/modules/stock-management/login.html', (req, res) => res.sendFile(path.join(__dirname, 'modules/stock-management/public/login.html')));
app.post('/modules/stock-management/api/auth/login', stockAuth.login);
app.post('/modules/stock-management/api/auth/logout', stockAuth.logout);
app.get('/modules/stock-management/api/auth/status', stockAuth.status);
app.use('/modules/stock-management', stockAuth.requireAuth, express.static(path.join(__dirname, 'modules/stock-management/public')));
app.use('/modules/stock-management/api', stockAuth.requireAuth, require('./modules/stock-management/backend/stock.routes'));

// ---------- Module 2: งานผสมเคมีบำบัดเฉพาะราย — ยังไม่มี backend (หน้า "อยู่ระหว่างพัฒนา") ----------
const chemoPrepAuth = createModuleAuth({
    moduleKey: 'chemo-prep', envUser: 'ADMIN_USERNAME', envPass: 'ADMIN_PASSWORD',
    loginPath: '/modules/chemo-prep/login.html'
});
app.get('/modules/chemo-prep/login.html', (req, res) => res.sendFile(path.join(__dirname, 'modules/chemo-prep/public/login.html')));
app.post('/modules/chemo-prep/api/auth/login', chemoPrepAuth.login);
app.post('/modules/chemo-prep/api/auth/logout', chemoPrepAuth.logout);
app.get('/modules/chemo-prep/api/auth/status', chemoPrepAuth.status);
app.use('/modules/chemo-prep', chemoPrepAuth.requireAuth, express.static(path.join(__dirname, 'modules/chemo-prep/public')));

// ---------- Module 3: Pharm Care Unit — ยังไม่มี backend (หน้า "อยู่ระหว่างพัฒนา") ----------
const pharmCareAuth = createModuleAuth({
    moduleKey: 'pharm-care-unit', envUser: 'ADMIN_USERNAME', envPass: 'ADMIN_PASSWORD',
    loginPath: '/modules/pharm-care-unit/login.html'
});
app.get('/modules/pharm-care-unit/login.html', (req, res) => res.sendFile(path.join(__dirname, 'modules/pharm-care-unit/public/login.html')));
app.post('/modules/pharm-care-unit/api/auth/login', pharmCareAuth.login);
app.post('/modules/pharm-care-unit/api/auth/logout', pharmCareAuth.logout);
app.get('/modules/pharm-care-unit/api/auth/status', pharmCareAuth.status);
app.use('/modules/pharm-care-unit', pharmCareAuth.requireAuth, express.static(path.join(__dirname, 'modules/pharm-care-unit/public')));

// ---------- Real-time: db module ต่างๆ emit เข้า eventBus (ดู eventBus.util.js) ----------
// ต่อเข้ากับ socket.io ที่นี่ที่เดียว — ฝั่งหน้าเว็บ (procurement.page.js / stock.page.js) ฟัง event เหล่านี้
// เพื่อรีเฟรชข้อมูลทันทีที่มีการเปลี่ยนแปลงจริง แทนที่จะพึ่ง polling ทุกกี่วินาทีเพียงอย่างเดียว
// เนื้อหาที่ส่งผ่าน socket มีแค่ id/เลขที่เอกสาร (ไม่ใช่ข้อมูลเต็ม) — ฝั่งรับต้อง fetch ผ่าน REST API
// ที่มี auth ตามปกติเพื่อเอาข้อมูลจริง จึงไม่มีความเสี่ยงข้อมูลรั่วข้ามโมดูลผ่าน socket
['requisition:created', 'shipment:created', 'receipt:created', 'drug:changed', 'data:cleared', 'lookup:changed'].forEach(eventName => {
    eventBus.on(eventName, (payload) => io.emit(eventName, payload));
});

httpServer.listen(PORT, () => {
    console.log(`SmartCtx v1.0.0 กำลังทำงานที่ http://localhost:${PORT}`);
});

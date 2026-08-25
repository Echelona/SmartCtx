/**
 * warehouseSchema.db.js — จุดเชื่อมต่อฐานข้อมูลกลางของ module งานคลัง (1.1 งานจัดซื้อ + 1.2 งานคลังเคมีบำบัด)
 * ทั้งสองโมดูลอ่าน/เขียนตาราง requisitions/requisition_items ชุดเดียวกันจากคนละฝั่ง
 * จึง require ไฟล์นี้ร่วมกันแทนที่จะมีฐานข้อมูลแยกคนละไฟล์
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'warehouse.db');

const db = new sqlite3.Database(DB_PATH);
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function withTransaction(fn) {
    await dbRun('BEGIN IMMEDIATE');
    try {
        const result = await fn();
        await dbRun('COMMIT');
        return result;
    } catch (err) {
        await dbRun('ROLLBACK').catch(() => {});
        throw err;
    }
}

async function nextDocNumber(prefix, table, dateColumn, dateValue) {
    const datePart = String(dateValue).replace(/-/g, '');
    const row = await dbGet(`SELECT COUNT(*) AS c FROM ${table} WHERE ${dateColumn} = ?`, [dateValue]);
    const seq = String((row?.c || 0) + 1).padStart(3, '0');
    return `${prefix}-${datePart}-${seq}`;
}

// item / strength / pack size แยกฟิลด์กันชัดเจน ตามที่ต้องใช้คำนวณแยกกันได้ในโมดูลเตรียมยาต่อไป
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    req_no TEXT UNIQUE NOT NULL,
    req_date TEXT NOT NULL,
    requested_by TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | partially_received | received | cancelled
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requisition_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL REFERENCES requisitions(id),
    drug_code TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    strength TEXT,
    strength_value REAL,
    strength_unit TEXT,
    pack_size_value REAL,
    pack_size_unit TEXT,
    pack_size TEXT,
    unit TEXT,
    qty_requested REAL NOT NULL,
    qty_shipped REAL NOT NULL DEFAULT 0,
    qty_received REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL REFERENCES requisitions(id),
    shipment_no TEXT UNIQUE NOT NULL,
    shipment_date TEXT NOT NULL,
    note TEXT,
    shipped_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    requisition_item_id INTEGER NOT NULL REFERENCES requisition_items(id),
    qty_shipped REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE NOT NULL,
    receipt_date TEXT NOT NULL,
    requisition_id INTEGER REFERENCES requisitions(id),
    note TEXT,
    received_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL REFERENCES receipts(id),
    drug_code TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    strength TEXT,
    strength_value REAL,
    strength_unit TEXT,
    pack_size_value REAL,
    pack_size_unit TEXT,
    pack_size TEXT,
    lot_no TEXT NOT NULL,
    mfg_date TEXT,
    exp_date TEXT,
    qty REAL NOT NULL,
    unit TEXT,
    unit_cost REAL
);

CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_code TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    strength TEXT,
    strength_value REAL,
    strength_unit TEXT,
    pack_size_value REAL,
    pack_size_unit TEXT,
    pack_size TEXT,
    lot_no TEXT NOT NULL,
    mfg_date TEXT,
    exp_date TEXT,
    qty_received REAL NOT NULL,
    qty_balance REAL NOT NULL,
    unit TEXT,
    unit_cost REAL,
    status TEXT NOT NULL DEFAULT 'active', -- active | depleted
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(drug_code, lot_no)
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    drug_code TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    lot_id INTEGER REFERENCES stock_lots(id),
    lot_no TEXT,
    movement_type TEXT NOT NULL, -- RECEIPT | ADJUSTMENT
    qty_change REAL NOT NULL,
    balance_after REAL NOT NULL,
    note TEXT,
    ref_type TEXT,
    ref_id INTEGER
);

CREATE TABLE IF NOT EXISTS drug_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    strength TEXT,
    strength_value REAL,
    strength_unit TEXT,
    pack_size_value REAL,
    pack_size_unit TEXT,
    pack_size TEXT,
    category TEXT,
    unit TEXT,
    default_cost REAL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lookup_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_type TEXT NOT NULL, -- 'unit' | 'pack_size' | 'strength_unit' | 'category'
    value TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(list_type, value)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL REFERENCES stock_lots(id),
    qty_change REAL NOT NULL,
    reason TEXT,
    user TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ---------- Migration: เพิ่มคอลัมน์ใหม่เข้าไฟล์ฐานข้อมูลเดิมที่เคยสร้างไว้ก่อน schema นี้จะเพิ่มคอลัมน์เข้ามา ----------
// สำคัญ: CREATE TABLE IF NOT EXISTS ด้านบน "ไม่" เพิ่มคอลัมน์ใหม่ให้ตารางที่มีอยู่แล้ว — ถ้าเคยรันแอปนี้
// มาก่อนตอนที่ schema ยังไม่มีคอลัมน์พวกนี้ (เช่น strength_value/pack_size_value ที่เพิ่มเข้ามาทีหลัง)
// ไฟล์ฐานข้อมูลเดิมจะขาดคอลัมน์เหล่านี้ไปเลย ทำให้ INSERT/UPDATE ที่อ้างถึงคอลัมน์นั้นพัง (SQLITE_ERROR: no such column)
// ฟังก์ชันนี้เช็คแล้วเติมคอลัมน์ที่ขาดให้อัตโนมัติทุกครั้งที่ server เริ่มทำงาน โดยไม่กระทบข้อมูลเดิมที่มีอยู่
const COLUMN_MIGRATIONS = [
    { table: 'drug_master', column: 'strength_value', type: 'REAL' },
    { table: 'drug_master', column: 'strength_unit', type: 'TEXT' },
    { table: 'drug_master', column: 'pack_size_value', type: 'REAL' },
    { table: 'drug_master', column: 'pack_size_unit', type: 'TEXT' },
    { table: 'requisition_items', column: 'strength_value', type: 'REAL' },
    { table: 'requisition_items', column: 'strength_unit', type: 'TEXT' },
    { table: 'requisition_items', column: 'pack_size_value', type: 'REAL' },
    { table: 'requisition_items', column: 'pack_size_unit', type: 'TEXT' },
    { table: 'receipt_items', column: 'strength_value', type: 'REAL' },
    { table: 'receipt_items', column: 'strength_unit', type: 'TEXT' },
    { table: 'receipt_items', column: 'pack_size_value', type: 'REAL' },
    { table: 'receipt_items', column: 'pack_size_unit', type: 'TEXT' },
    { table: 'stock_lots', column: 'strength_value', type: 'REAL' },
    { table: 'stock_lots', column: 'strength_unit', type: 'TEXT' },
    { table: 'stock_lots', column: 'pack_size_value', type: 'REAL' },
    { table: 'stock_lots', column: 'pack_size_unit', type: 'TEXT' }
];

function tableInfo(table) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function runColumnMigrations() {
    for (const m of COLUMN_MIGRATIONS) {
        const columns = await tableInfo(m.table);
        if (!columns.length) continue; // ตารางยังไม่มีอยู่เลย (จะถูกสร้างครบตาม schema ล่าสุดอยู่แล้ว ไม่ต้อง migrate)
        const exists = columns.some(c => c.name === m.column);
        if (!exists) {
            await new Promise((resolve, reject) => {
                db.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`, (err) => (err ? reject(err) : resolve()));
            });
            console.log(`schema migration: เพิ่มคอลัมน์ ${m.column} เข้า ${m.table} (ฐานข้อมูลเดิมที่ยังไม่มีคอลัมน์นี้)`);
        }
    }
}

const ready = new Promise((resolve, reject) => {
    db.exec(SCHEMA_SQL, (err) => {
        if (err) return reject(err);
        runColumnMigrations().then(resolve).catch(reject);
    });
});

// ---------- Checkpoint WAL เข้าไฟล์หลัก (ใช้ก่อนสำรอง/ย้ายฐานข้อมูล) ----------
// เพราะเปิดแบบ WAL mode ไว้ (ดู PRAGMA journal_mode = WAL ด้านบน) ข้อมูลที่เพิ่งเขียนล่าสุดจะยังไม่ถูก
// merge เข้าไฟล์ warehouse.db หลักทันที แต่จะอยู่ในไฟล์แยก warehouse.db-wal ก่อน ถ้า copy/สำรองแค่ไฟล์
// warehouse.db ไฟล์เดียวโดยไม่ได้เอา -wal/-shm ไปด้วย ข้อมูลล่าสุดจะหายไป — ฟังก์ชันนี้สั่ง SQLite รวม
// ข้อมูลทั้งหมดจาก WAL เข้าไฟล์หลักแล้วเคลียร์ WAL ให้ว่าง (TRUNCATE) ทำให้หลังรันแล้ว copy/backup แค่ไฟล์
// warehouse.db ไฟล์เดียวก็ได้ข้อมูลครบ ไม่ต้อง zip รวมไฟล์ -wal/-shm ไปด้วย
function checkpointDatabase() {
    return new Promise((resolve, reject) => {
        db.get('PRAGMA wal_checkpoint(TRUNCATE)', (err, row) => {
            if (err) return reject(err);
            // row: { busy, log, checkpointed } — busy=1 หมายถึงมี connection อื่นค้างอยู่ ทำให้ checkpoint
            // ไม่ครบ (บางส่วนอาจยังเหลือใน WAL) — log/checkpointed คือจำนวนหน้าทั้งหมด/ที่ merge ไปแล้ว
            resolve({
                busy: !!row?.busy,
                totalPages: row?.log ?? 0,
                checkpointedPages: row?.checkpointed ?? 0
            });
        });
    });
}

module.exports = { db, dbRun, dbGet, dbAll, withTransaction, nextDocNumber, ready, DB_PATH, checkpointDatabase };
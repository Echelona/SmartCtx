/**
 * stock.db.js — ตรรกะข้อมูลฝั่งงานคลังเคมีบำบัด (1.2 Stock management)
 * ส่งรายการจัดซื้อ (สร้างใบเบิก) ไปให้งานจัดซื้อ (1.1) แล้วรับเข้าตามใบส่งของ — อาจมีค้างจ่าย (partial)
 */

const crypto = require('crypto');
const { dbRun, dbGet, dbAll, withTransaction, nextDocNumber, ready, checkpointDatabase } = require('../../_shared/backend/warehouseSchema.db');
const { CHEMO_DRUG_REFERENCE, LOOKUP_SEED_DATA } = require('../../../shared-data/chemoDrugs.data');
const eventBus = require('../../_shared/backend/eventBus.util');
const { runGuardedUpdate } = require('../../_shared/backend/concurrency.util');

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

// ตรวจสอบความสมเหตุสมผลของวันผลิต/วันหมดอายุ ก่อนรับเข้าคลังทุกครั้ง
// - วันผลิตห้ามเป็นอนาคต (ผลิตแล้วแต่ยังไม่ถึงวันนั้นจริงไม่มีทางเป็นไปได้)
// - วันหมดอายุห้ามเป็นอดีต (ของหมดอายุแล้วไม่ควรเข้าคลังใช้งานได้)
// - วันหมดอายุต้องอยู่หลังวันผลิตเสมอ (ถ้ามีทั้งสองค่า)
function validateLotDates(it) {
    const today = todayIso();
    if (it.mfgDate && it.mfgDate > today) {
        return `${it.drugName}: วันผลิต (${it.mfgDate}) เป็นวันที่ในอนาคต ไม่ถูกต้อง`;
    }
    if (it.expDate && it.expDate < today) {
        return `${it.drugName}: วันหมดอายุ (${it.expDate}) หมดอายุไปแล้ว ไม่สามารถรับเข้าคลังใช้งานได้`;
    }
    if (it.mfgDate && it.expDate && it.expDate <= it.mfgDate) {
        return `${it.drugName}: วันหมดอายุต้องอยู่หลังวันผลิตเสมอ`;
    }
    return null;
}

// รวมค่าตัวเลข+หน่วยเป็นข้อความแสดงผล เช่น (50, 'mg') -> '50 mg' — ใช้ตอนไม่ได้ส่งข้อความ strength มาตรงๆ
function deriveStrengthDisplay(value, unit) {
    if (value === undefined || value === null || value === '') return null;
    return unit ? `${value} ${unit}` : String(value);
}

// ---------- Drug master (item / ความแรง / ขนาดบรรจุ — บริหารจัดการได้ ไม่ใช่ list ตายตัว) ----------
// ตามแนวทางเดียวกับ admin.js (SmartPharmacy): ข้อมูลยาเป็น master data ที่เพิ่ม/แก้/ลบได้ผ่านฟอร์ม
// ไม่ใช่ hardcode — seed รายการเริ่มต้นจาก CHEMO_DRUG_REFERENCE ให้ครั้งแรกที่รันเท่านั้น (ตารางว่างเปล่า)
// เพื่อไม่ให้ทับข้อมูลที่ผู้ใช้แก้ไขไปแล้วในภายหลัง

async function seedDrugMasterIfEmpty() {
    await ready;
    const row = await dbGet(`SELECT COUNT(*) AS c FROM drug_master`);
    if (row?.c > 0) return; // มีข้อมูลอยู่แล้ว (อาจถูกแก้ไขโดยผู้ใช้) — ไม่ seed ทับ
    await withTransaction(async () => {
        for (const d of CHEMO_DRUG_REFERENCE) {
            await dbRun(
                `INSERT OR IGNORE INTO drug_master (drug_code, name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit, category, unit, default_cost, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
                [d.code, d.name, d.strength, d.strengthValue ?? null, d.strengthUnit ?? null, d.packSize, d.packSizeValue ?? null, d.packSizeUnit ?? null, 'เคมีบำบัด', d.unit]
            );
        }
    });
    console.log(`stock.db: seed รายการยาเริ่มต้น ${CHEMO_DRUG_REFERENCE.length} รายการเข้า drug_master (ครั้งแรกเท่านั้น)`);
}
// เรียกจริงที่ท้ายไฟล์ (รวมกับ seedLookupOptionsIfEmpty) เพื่อไม่ให้สอง transaction เริ่มพร้อมกันแล้วชนกัน

// ---------- Lookup options (หน่วย / ขนาดบรรจุ / หน่วยความแรง / หมวดหมู่ — dropdown ที่แก้ไข/เพิ่มตัวเลือกเองได้ภายหลัง) ----------

const VALID_LIST_TYPES = ['unit', 'pack_size_unit', 'strength_unit', 'category', 'drug_type', 'dosage_form'];

function assertValidListType(listType) {
    if (!VALID_LIST_TYPES.includes(listType)) {
        const err = new Error(`ประเภทตัวเลือกไม่ถูกต้อง: ${listType}`);
        err.status = 400;
        throw err;
    }
}

// ค่าเริ่มต้นสำหรับ dropdown "ประเภทยา"/"รูปแบบยา" — seed ให้เองในไฟล์นี้ (ไม่ผ่าน LOOKUP_SEED_DATA จาก
// shared-data เพราะไฟล์นั้นยังไม่มีสองประเภทนี้) ใช้เฉพาะตอนตารางว่างเปล่าครั้งแรกเหมือนตัวเลือกอื่นๆ
const LOCAL_LOOKUP_DEFAULTS = {
    drug_type: ['injection', 'Tablet'],
    dosage_form: [
        'solution',
        'powder for solution(Recon.NSS or SWFI)',
        'powder for solution(Recon.NSS or D5W)',
        'powder for solution(Recon.SWFI only)',
        'powder for solution(Recon.Solvent,SWFI)',
        'powder for solution(Recon.NSS)',
        'Tablet'
    ]
};

async function seedLookupOptionsIfEmpty() {
    await ready;
    for (const listType of VALID_LIST_TYPES) {
        const row = await dbGet(`SELECT COUNT(*) AS c FROM lookup_options WHERE list_type = ?`, [listType]);
        if (row?.c > 0) continue; // มีอยู่แล้ว (อาจถูกแก้ไขโดยผู้ใช้) — ไม่ seed ทับ
        const values = (LOOKUP_SEED_DATA[listType] && LOOKUP_SEED_DATA[listType].length)
            ? LOOKUP_SEED_DATA[listType]
            : (LOCAL_LOOKUP_DEFAULTS[listType] || []);
        await withTransaction(async () => {
            for (const value of values) {
                await dbRun(`INSERT OR IGNORE INTO lookup_options (list_type, value, active) VALUES (?, ?, 1)`, [listType, value]);
            }
        });
    }
    console.log('stock.db: seed ตัวเลือก dropdown เริ่มต้น (หน่วย/ขนาดบรรจุ/หน่วยความแรง/หมวดหมู่/ประเภทยา/รูปแบบยา) เสร็จแล้ว (ครั้งแรกเท่านั้น)');
}
// ---------- Migration: เพิ่มคอลัมน์ audit สำหรับการยกเลิกใบเบิก (เผื่อ DB เก่ายังไม่มี) ----------
async function ensureCancelAuditColumns() {
    await ready;
    const cols = await dbAll(`PRAGMA table_info(requisitions)`);
    const names = cols.map(c => c.name);
    if (!names.includes('cancelled_by')) await dbRun(`ALTER TABLE requisitions ADD COLUMN cancelled_by TEXT`);
    if (!names.includes('cancelled_at')) await dbRun(`ALTER TABLE requisitions ADD COLUMN cancelled_at TEXT`);
}

// ---------- Migration: เพิ่มคอลัมน์ version สำหรับกันผู้ใช้หลายคนแก้ข้อมูลเดียวกันพร้อมกัน (optimistic
// concurrency control — ดู concurrency.util.js) เฉพาะตารางที่เป็น "ข้อมูลตั้งค่า" ที่แก้ไขทั้งแถวได้อิสระ
// (drug_master, lookup_options) — ส่วนตารางที่เป็นยอด/จำนวน (stock_lots, requisition_items) ใช้ยอด
// คงเหลือจริงเป็นเงื่อนไขกันชนแทน ไม่ต้องมีคอลัมน์ version แยก (ดู adjustLot / createShipment / createReceipt)
async function ensureConcurrencyVersionColumns() {
    await ready;
    for (const table of ['drug_master', 'lookup_options']) {
        const cols = await dbAll(`PRAGMA table_info(${table})`);
        if (!cols.map(c => c.name).includes('version')) {
            await dbRun(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
        }
    }
}

// ---------- Migration: เพิ่มคอลัมน์รายละเอียดยาเคมีบำบัด (ตามรายการ listยาเคมีบำบัด.xlsx) เข้า drug_master
// (เผื่อ DB เก่ายังไม่มี) — ครอบคลุมชื่อการค้า/รูปแบบยา/ประเภทยา/หมายเหตุแหล่งจัดหา/ความเข้มข้นก่อน-หลังผสม/
// อายุหลังเปิดขวด/ตัวทำละลาย/ยาที่เข้ากันได้-ไม่ได้/ราคาขาย/ระดับสต๊อกขั้นต่ำ-สูงสุด
const DRUG_MASTER_EXTRA_COLUMNS = [
    ['trade_name', 'TEXT'],
    ['drug_type', 'TEXT'],
    ['dosage_form', 'TEXT'],
    ['remark', 'TEXT'],
    ['conc_before_mix', 'TEXT'],
    ['shelf_life_after_open', 'TEXT'],
    ['max_conc_after_mix', 'TEXT'],
    ['diluent', 'TEXT'],
    ['compatible_drugs', 'TEXT'],
    ['incompatible_drugs', 'TEXT'],
    ['selling_price', 'REAL'],
    ['min_stock_qty', 'REAL'],
    ['max_stock_qty', 'REAL'],
    ['superseded_by_code', 'TEXT'] // รหัสยาที่ใช้แทน — ตั้งค่าตอนปิดใช้งานรายการนี้เพราะย้ายไปรหัสใหม่ (successor record, ดู setSupersededBy)
];
async function ensureDrugMasterExtraColumns() {
    await ready;
    const cols = await dbAll(`PRAGMA table_info(drug_master)`);
    const names = cols.map(c => c.name);
    for (const [col, type] of DRUG_MASTER_EXTRA_COLUMNS) {
        if (!names.includes(col)) {
            await dbRun(`ALTER TABLE drug_master ADD COLUMN ${col} ${type}`);
        }
    }
}

// รัน seed/migration ทั้งหมดตามลำดับเสมอ (ห้ามยิงพร้อมกัน) — sqlite connection เดียวรองรับ transaction ซ้อนกันไม่ได้
// (เจอบั๊กจริง: "cannot start a transaction within a transaction" ตอนสอง seed function เริ่มพร้อมกันแบบไม่ chain)
(async () => {
    try { await seedDrugMasterIfEmpty(); } catch (err) { console.error('seed drug_master ไม่สำเร็จ:', err); }
    try { await seedLookupOptionsIfEmpty(); } catch (err) { console.error('seed lookup_options ไม่สำเร็จ:', err); }
    try { await ensureCancelAuditColumns(); } catch (err) { console.error('migrate cancel-audit columns ไม่สำเร็จ:', err); }
    try { await ensureConcurrencyVersionColumns(); } catch (err) { console.error('migrate concurrency version columns ไม่สำเร็จ:', err); }
    try { await ensureDrugMasterExtraColumns(); } catch (err) { console.error('migrate drug_master extra columns ไม่สำเร็จ:', err); }
})();

async function listLookupOptions(listType, { activeOnly } = {}) {
    assertValidListType(listType);
    return dbAll(
        activeOnly
            ? `SELECT * FROM lookup_options WHERE list_type = ? AND active = 1 ORDER BY value`
            : `SELECT * FROM lookup_options WHERE list_type = ? ORDER BY value`,
        [listType]
    );
}

async function createLookupOption(listType, value) {
    assertValidListType(listType);
    if (!value || !value.trim()) {
        const err = new Error('กรุณาระบุค่าตัวเลือก');
        err.status = 400;
        throw err;
    }
    try {
        const { lastID } = await dbRun(`INSERT INTO lookup_options (list_type, value, active) VALUES (?, ?, 1)`, [listType, value.trim()]);
        const row = await dbGet(`SELECT * FROM lookup_options WHERE id = ?`, [lastID]);
        eventBus.emit('lookup:changed', { listType, action: 'created' });
        return row;
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
            const e = new Error('ตัวเลือกนี้มีอยู่แล้ว');
            e.status = 409;
            throw e;
        }
        throw err;
    }
}

async function updateLookupOption(id, { value, active, version }) {
    const existing = await dbGet(`SELECT * FROM lookup_options WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบตัวเลือกที่ระบุ');
        err.status = 404;
        throw err;
    }
    if (version === undefined || version === null) {
        const err = new Error('ข้อมูลเวอร์ชันไม่ครบ — กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
        err.status = 400;
        throw err;
    }
    try {
        // เช็ค version ใน WHERE เดียวกับ UPDATE (pattern กลาง — ดู concurrency.util.js): ถ้าตอนนี้ version
        // ในฐานข้อมูลไม่ตรงกับที่ผู้ใช้โหลดไปตอนแรก แปลว่ามีคนอื่นแก้ตัวเลือกนี้ไปแล้วระหว่างที่ผู้ใช้กำลังแก้อยู่
        await runGuardedUpdate(dbRun,
            `UPDATE lookup_options SET value = ?, active = ?, version = version + 1 WHERE id = ? AND version = ?`,
            [(value ?? existing.value).trim(), active === undefined ? existing.active : (active ? 1 : 0), id, version],
            'ตัวเลือกนี้ถูกแก้ไขโดยผู้ใช้อื่นไปแล้วระหว่างที่คุณกำลังแก้ไข กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง'
        );
        const row = await dbGet(`SELECT * FROM lookup_options WHERE id = ?`, [id]);
        eventBus.emit('lookup:changed', { listType: row.list_type, action: 'updated' });
        return row;
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
            const e = new Error('ค่านี้มีอยู่แล้วในรายการเดียวกัน');
            e.status = 409;
            throw e;
        }
        throw err;
    }
}

async function listDrugs({ activeOnly } = {}) {
    const rows = await dbAll(
        activeOnly ? `SELECT * FROM drug_master WHERE active = 1 ORDER BY name` : `SELECT * FROM drug_master ORDER BY name`
    );
    return rows;
}

// สร้างรหัสยาอัตโนมัติ รูปแบบ yymmxxx — yy = ปี พ.ศ. (พุทธศักราช) 2 หลักท้าย, mm = เดือนปัจจุบัน (01-12),
// xxx = ลำดับที่ 3 หลัก นับจากจำนวนรหัสยาที่ขึ้นต้นด้วย yymm เดียวกันที่มีอยู่แล้ว (ลำดับรีเซ็ตใหม่ทุกเดือน)
// ต้องเรียกภายใน withTransaction เดียวกับ INSERT เสมอ (ดู createDrug) — SQLite BEGIN IMMEDIATE ล็อกการเขียน
// ทำให้สอง request ที่สร้างยาพร้อมกันถูก serialize อัตโนมัติ กันได้เลขซ้ำกันจาก race condition
async function generateDrugCode() {
    const now = new Date();
    const beYear = now.getFullYear() + 543; // พ.ศ. = ค.ศ. + 543
    const yy = String(beYear).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `${yy}${mm}`;
    // ใช้ underscore (SQLite LIKE wildcard แทนตัวอักษร 1 ตัว) x3 แทน % กว้างๆ — กันนับรวมรหัสเก่าที่บังเอิญ
    // ขึ้นต้นด้วยตัวเลข 4 หลักเดียวกันแต่ยาวกว่า/รูปแบบต่างออกไป (เช่นรหัสเดิมก่อนเปลี่ยนมาใช้ระบบนี้)
    const row = await dbGet(`SELECT COUNT(*) AS c FROM drug_master WHERE drug_code LIKE ?`, [`${prefix}___`]);
    const seq = String((row?.c || 0) + 1).padStart(3, '0');
    return `${prefix}${seq}`;
}

async function createDrug({
    name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost,
    tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
    compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
}) {
    if (!name) {
        const err = new Error('ต้องระบุชื่อยา');
        err.status = 400;
        throw err;
    }
    // รหัสยาสร้างอัตโนมัติเสมอ (รูปแบบ yymmxxx) — ไม่รับรหัสจาก client แม้ส่งมาก็ตาม กันหลุดผ่านการยิง API ตรงๆ
    const displayStrength = (strengthValue !== undefined && strengthValue !== null && strengthValue !== '')
        ? deriveStrengthDisplay(strengthValue, strengthUnit)
        : (strength || null);
    const displayPackSize = (packSizeValue !== undefined && packSizeValue !== null && packSizeValue !== '')
        ? deriveStrengthDisplay(packSizeValue, packSizeUnit)
        : (packSize || null);
    try {
        const row = await withTransaction(async () => {
            const drugCode = await generateDrugCode();
            const { lastID } = await dbRun(
                `INSERT INTO drug_master (
                    drug_code, name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit,
                    category, unit, default_cost, active,
                    trade_name, drug_type, dosage_form, remark, conc_before_mix, shelf_life_after_open,
                    max_conc_after_mix, diluent, compatible_drugs, incompatible_drugs, selling_price, min_stock_qty, max_stock_qty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    drugCode, name, displayStrength, strengthValue || null, strengthUnit || null, displayPackSize, packSizeValue || null, packSizeUnit || null,
                    category || null, unit || null, defaultCost || null,
                    tradeName || null, drugType || null, dosageForm || null, remark || null,
                    concBeforeMix || null, shelfLifeAfterOpen || null, maxConcAfterMix || null, diluent || null,
                    compatibleDrugs || null, incompatibleDrugs || null, sellingPrice || null, minStockQty || null, maxStockQty || null
                ]
            );
            return dbGet(`SELECT * FROM drug_master WHERE id = ?`, [lastID]);
        });
        eventBus.emit('drug:changed', { id: row.id, action: 'created' });
        return row;
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
            const e = new Error('รหัสยานี้มีอยู่แล้ว กรุณาใช้รหัสอื่น');
            e.status = 409;
            throw e;
        }
        throw err;
    }
}

async function updateDrug(id, {
    name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active, version,
    tradeName, drugType, dosageForm, remark, concBeforeMix, shelfLifeAfterOpen, maxConcAfterMix, diluent,
    compatibleDrugs, incompatibleDrugs, sellingPrice, minStockQty, maxStockQty
}) {
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
        throw err;
    }
    if (version === undefined || version === null) {
        const err = new Error('ข้อมูลเวอร์ชันไม่ครบ — กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
        err.status = 400;
        throw err;
    }
    const newStrengthValue = strengthValue !== undefined ? strengthValue : existing.strength_value;
    const newStrengthUnit = strengthUnit !== undefined ? strengthUnit : existing.strength_unit;
    const newDisplayStrength = (strengthValue !== undefined || strengthUnit !== undefined)
        ? deriveStrengthDisplay(newStrengthValue, newStrengthUnit)
        : (strength ?? existing.strength);
    const newPackSizeValue = packSizeValue !== undefined ? packSizeValue : existing.pack_size_value;
    const newPackSizeUnit = packSizeUnit !== undefined ? packSizeUnit : existing.pack_size_unit;
    const newDisplayPackSize = (packSizeValue !== undefined || packSizeUnit !== undefined)
        ? deriveStrengthDisplay(newPackSizeValue, newPackSizeUnit)
        : (packSize ?? existing.pack_size);
    // เช็ค version ใน WHERE เดียวกับ UPDATE (pattern กลาง — ดู concurrency.util.js): กันสองคนแก้ยาตัวเดียวกัน
    // พร้อมกันแล้วคนหลังเขียนทับการแก้ไขของคนแรกไปเงียบๆ โดยไม่รู้ตัว
    await runGuardedUpdate(dbRun,
        `UPDATE drug_master SET
            name = ?, strength = ?, strength_value = ?, strength_unit = ?, pack_size = ?, pack_size_value = ?, pack_size_unit = ?,
            category = ?, unit = ?, default_cost = ?, active = ?,
            trade_name = ?, drug_type = ?, dosage_form = ?, remark = ?, conc_before_mix = ?, shelf_life_after_open = ?,
            max_conc_after_mix = ?, diluent = ?, compatible_drugs = ?, incompatible_drugs = ?, selling_price = ?, min_stock_qty = ?, max_stock_qty = ?,
            version = version + 1
         WHERE id = ? AND version = ?`,
        [
            name ?? existing.name,
            newDisplayStrength,
            newStrengthValue || null,
            newStrengthUnit || null,
            newDisplayPackSize,
            newPackSizeValue || null,
            newPackSizeUnit || null,
            category ?? existing.category,
            unit ?? existing.unit,
            defaultCost ?? existing.default_cost,
            active === undefined ? existing.active : (active ? 1 : 0),
            tradeName ?? existing.trade_name,
            drugType ?? existing.drug_type,
            dosageForm ?? existing.dosage_form,
            remark ?? existing.remark,
            concBeforeMix ?? existing.conc_before_mix,
            shelfLifeAfterOpen ?? existing.shelf_life_after_open,
            maxConcAfterMix ?? existing.max_conc_after_mix,
            diluent ?? existing.diluent,
            compatibleDrugs ?? existing.compatible_drugs,
            incompatibleDrugs ?? existing.incompatible_drugs,
            sellingPrice ?? existing.selling_price,
            minStockQty ?? existing.min_stock_qty,
            maxStockQty ?? existing.max_stock_qty,
            id,
            version
        ],
        'ข้อมูลยารายการนี้ถูกแก้ไขโดยผู้ใช้อื่นไปแล้วระหว่างที่คุณกำลังแก้ไข กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง'
    );
    const row = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    eventBus.emit('drug:changed', { id: row.id, action: 'updated' });
    return row;
}

// ตั้งค่า/ล้าง "รหัสยาที่ใช้แทน" (successor) — คู่กับ deleteDrug (soft-delete) ตอนรหัสยาเดิมถูกปิดใช้งานเพราะ
// ต้องย้ายไปใช้รหัสใหม่แทน (รหัสยาแก้ไขตรงๆ ไม่ได้เลยตั้งแต่สร้างแล้ว — ต้องปิดใช้งานเดิม+สร้างใหม่เสมอ) ลิงก์นี้
// ทำให้คนที่มาเจอรายการเก่าที่ถูกปิดใช้งานรู้ทันทีว่าต้องไปใช้รหัสไหนแทน (successor record pattern มาตรฐานของระบบ MDM) ส่ง supersededByCode เป็นค่าว่าง/null เพื่อล้างลิงก์
async function setSupersededBy(id, supersededByCode) {
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
        throw err;
    }
    let code = null;
    if (supersededByCode && supersededByCode.trim()) {
        code = supersededByCode.trim().toUpperCase();
        if (code === existing.drug_code) {
            const err = new Error('รหัสยาที่ใช้แทนต้องไม่ใช่รหัสเดียวกับรายการนี้');
            err.status = 400;
            throw err;
        }
        const target = await dbGet(`SELECT id FROM drug_master WHERE drug_code = ?`, [code]);
        if (!target) {
            const err = new Error(`ไม่พบรหัสยา "${code}" ในระบบ — กรุณาสร้างรายการยาใหม่ด้วยรหัสนี้ก่อน แล้วค่อยกลับมาลิงก์`);
            err.status = 400;
            throw err;
        }
    }
    await dbRun(`UPDATE drug_master SET superseded_by_code = ? WHERE id = ?`, [code, id]);
    const row = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    eventBus.emit('drug:changed', { id: row.id, action: 'superseded_by_changed' });
    return row;
}

// ลบแบบ soft-delete (active=0) แทนการลบจริง — เพราะใบเบิก/ใบรับเข้าเก่าเก็บชื่อ/ความแรง ณ ตอนนั้นแยกไว้อยู่แล้ว (denormalized)
// การซ่อนออกจาก dropdown ตัวเลือกใหม่จึงปลอดภัยกว่าการลบทิ้งจริง ไม่กระทบประวัติเก่า
async function deleteDrug(id) {
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
        throw err;
    }
    await dbRun(`UPDATE drug_master SET active = 0 WHERE id = ?`, [id]);
    eventBus.emit('drug:changed', { id, action: 'deactivated' });
    return { id, active: 0 };
}

// เปิดใช้งานกลับ (undo ของ deleteDrug ด้านบน) — ให้ยารายการที่เคย "ปิดใช้งาน" กลับมาแสดงใน dropdown
// เลือกยาต่างๆ ได้อีกครั้ง ไม่กระทบประวัติเก่าเพราะไม่ได้ลบข้อมูลไปตั้งแต่แรก
async function reactivateDrug(id) {
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
        throw err;
    }
    await dbRun(`UPDATE drug_master SET active = 1 WHERE id = ?`, [id]);
    eventBus.emit('drug:changed', { id, action: 'reactivated' });
    return { id, active: 1 };
}

// ลบถาวรจริง (ลบแถวออกจากตาราง) — ต่างจาก deleteDrug ด้านบนที่เป็น soft-delete เท่านั้น
// ยังปลอดภัยกับประวัติเก่าเช่นกันเพราะใบเบิก/ใบรับเข้า/สต๊อกเก่าเก็บชื่อ/ความแรง denormalized แยกไว้แล้ว
// ไม่มี FK อ้างถึง drug_master.id — แต่ตัวรายการยาเองจะหายไปจากระบบถาวร กู้คืนไม่ได้
// ลบถาวรจริง — ต้องยืนยันด้วยรหัสผ่านเดียวกับ clearTestData (SUDO_CLEAR_PASSWORD) เพราะเป็นการลบข้อมูล
// ถาวร กู้คืนไม่ได้เช่นกัน
async function hardDeleteDrug(id, password) {
    if (!password || password !== process.env.SUDO_CLEAR_PASSWORD) {
        const err = new Error('รหัสผ่านไม่ถูกต้อง — ไม่ได้รับอนุญาตให้ลบรายการยาถาวร');
        err.status = 403;
        throw err;
    }
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
        throw err;
    }
    await dbRun(`DELETE FROM drug_master WHERE id = ?`, [id]);
    // pack ฐานข้อมูล (VACUUM) หลังลบถาวรทุกครั้ง เพื่อคืนพื้นที่ดิสก์ที่ลบไปจริงๆ — ต้องรันนอก
    // transaction เสมอ (SQLite ไม่อนุญาตให้ VACUUM ระหว่าง BEGIN...COMMIT) เหมือน pattern ใน clearTestData
    await dbRun('VACUUM');
    eventBus.emit('drug:changed', { id, action: 'deleted' });
    return { id, deleted: true };
}

function computeStatus(items) {
    if (!items.length) return 'pending';
    const totalReq = items.reduce((s, it) => s + it.qty_requested, 0);
    const totalRecv = items.reduce((s, it) => s + it.qty_received, 0);
    if (totalRecv <= 0) return 'pending';
    if (totalRecv >= totalReq) return 'received';
    return 'partially_received';
}

// ---------- ใบเบิก/รายการจัดซื้อ (ส่งไปให้งานจัดซื้อ) ----------

async function createRequisition({ reqDate, requestedBy, note, items }) {
    if (!items || !items.length) {
        const err = new Error('ต้องมีรายการยาอย่างน้อย 1 รายการ');
        err.status = 400;
        throw err;
    }
    const date = reqDate || todayIso();
    return withTransaction(async () => {
        const reqNo = await nextDocNumber('REQ', 'requisitions', 'req_date', date);
        const { lastID } = await dbRun(
            `INSERT INTO requisitions (req_no, req_date, requested_by, note, status) VALUES (?, ?, ?, ?, 'pending')`,
            [reqNo, date, requestedBy || null, note || null]
        );
        for (const it of items) {
            await dbRun(
                `INSERT INTO requisition_items (requisition_id, drug_code, drug_name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit, unit, qty_requested)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [lastID, it.drugCode, it.drugName, it.strength || null, it.strengthValue ?? null, it.strengthUnit ?? null, it.packSize || null, it.packSizeValue ?? null, it.packSizeUnit ?? null, it.unit || null, Number(it.qtyRequested)]
            );
        }
        return { id: lastID, req_no: reqNo };
    }).then(result => {
        eventBus.emit('requisition:created', { id: result.id, req_no: result.req_no });
        return result;
    });
}

function computeShipStatus(items) {
    if (!items.length) return 'not_shipped';
    const totalReq = items.reduce((s, it) => s + it.qty_requested, 0);
    const totalShipped = items.reduce((s, it) => s + it.qty_shipped, 0);
    if (totalShipped <= 0) return 'not_shipped';
    if (totalShipped >= totalReq) return 'shipped';
    return 'partially_shipped';
}

// รองรับกรองตามช่วงวันที่เบิก (from/to, inclusive) และค้นหาเลขที่ใบเบิกแบบ partial match (reqNo)
// นอกเหนือจากสถานะเดิม (status) — ใช้กับทั้งตาราง "รายการใบเบิกทั้งหมด" และหน้าประวัติต่างๆ
async function listRequisitions({ status, from, to, reqNo } = {}) {
    let sql = `SELECT * FROM requisitions WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (from) { sql += ` AND req_date >= ?`; params.push(from); }
    if (to) { sql += ` AND req_date <= ?`; params.push(to); }
    if (reqNo) { sql += ` AND req_no LIKE ?`; params.push(`%${reqNo}%`); }
    sql += ` ORDER BY id DESC`;
    const rows = await dbAll(sql, params);
    const out = [];
    for (const r of rows) {
        const items = await dbAll(`SELECT * FROM requisition_items WHERE requisition_id = ?`, [r.id]);
        out.push({ ...r, itemCount: items.length, shipStatus: computeShipStatus(items) });
    }
    return out;
}

async function getRequisition(id) {
    const r = await dbGet(`SELECT * FROM requisitions WHERE id = ?`, [id]);
    if (!r) return null;
    const items = await dbAll(`SELECT * FROM requisition_items WHERE requisition_id = ?`, [id]);
    return { ...r, items, shipStatus: computeShipStatus(items) };
}

// เทียบรหัสผ่านแบบ timing-safe — !== ธรรมดาจะ short-circuit ตัวแรกที่ไม่ตรง ทำให้เวลาตอบสนอง
// สั้น/ยาวต่างกันตามจำนวนตัวอักษรที่ตรง เป็นช่องโหว่ให้เดารหัสผ่านทีละตัวได้ (timing attack)
function verifyPassword(input, expected) {
    if (!input || !expected) return false;
    const a = Buffer.from(String(input));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false; // timingSafeEqual ต้องการ buffer ยาวเท่ากันเท่านั้น
    return crypto.timingSafeEqual(a, b);
}

// ยกเลิกใบเบิก — ต้องยืนยันด้วยรหัสผ่านแยกต่างหาก (CANCEL_REQ_PASSWORD, ไม่ใช่รหัส login ปกติ)
// เพราะเป็น action ที่กระทบฝั่งงานจัดซื้อโดยตรงและย้อนกลับไม่ได้ — บันทึกผู้ยกเลิก/เวลาไว้เป็น audit
// cancelledBy ควรมาจาก session ของผู้ใช้ที่ login อยู่ (ดู getUser(req) ใน stock.routes.js) ไม่ใช่ค่าที่ client กำหนดเอง
async function cancelRequisition(id, password, cancelledBy) {
    if (!verifyPassword(password, process.env.CANCEL_REQ_PASSWORD)) {
        const err = new Error('รหัสผ่านไม่ถูกต้อง — ไม่ได้รับอนุญาตให้ยกเลิกใบเบิก');
        err.status = 403;
        throw err;
    }
    const r = await dbGet(`SELECT * FROM requisitions WHERE id = ?`, [id]);
    if (!r) {
        const err = new Error('ไม่พบใบเบิกที่ระบุ');
        err.status = 404;
        throw err;
    }
    if (r.status !== 'pending') {
        const err = new Error('ยกเลิกได้เฉพาะใบเบิกที่ยังไม่มีการรับเข้าเท่านั้น');
        err.status = 409;
        throw err;
    }
    const now = new Date().toISOString();
    // เช็ค status='pending' ใน WHERE เดียวกับ UPDATE (pattern กลาง — ดู concurrency.util.js): เผื่อระหว่าง
    // ที่อ่าน r.status ข้างบนกับตอนนี้ มีคนอื่นเริ่มจัดส่ง/รับเข้าไปแล้ว (เปลี่ยนสถานะไปจาก pending) พอดี
    await runGuardedUpdate(dbRun,
        `UPDATE requisitions SET status = 'cancelled', cancelled_by = ?, cancelled_at = ? WHERE id = ? AND status = 'pending'`,
        [cancelledBy || null, now, id],
        'ใบเบิกนี้ถูกเปลี่ยนสถานะไปแล้ว (เช่น เริ่มมีการจัดส่ง/รับเข้า) ก่อนที่คำสั่งยกเลิกจะสำเร็จ กรุณาโหลดข้อมูลใหม่'
    );
    // แจ้งฝั่งงานจัดซื้อ (procurement) แบบ realtime ว่าใบเบิกนี้ถูกยกเลิกแล้ว
    // — ไม่งั้นสถานะที่ DB เปลี่ยนถูกต้อง แต่ UI ฝั่งจัดซื้อจะไม่รีเฟรชจนกว่าจะโหลดข้อมูลใหม่เอง
    eventBus.emit('requisition:cancelled', { id: Number(id), req_no: r.req_no });
    return getRequisition(id);
}

// ---------- รับเข้าคลังตามใบส่งของจากงานจัดซื้อ (สร้าง/เติม Lot) — อาจรับไม่ครบ (ค้างจ่าย) ----------

async function createReceipt({ receiptDate, reqId, receivedBy, note, items }) {
    if (!items || !items.length) {
        const err = new Error('ต้องมีรายการยาอย่างน้อย 1 รายการ');
        err.status = 400;
        throw err;
    }

    // ตรวจวันผลิต/วันหมดอายุของทุกรายการก่อน ถ้ามีรายการไหนไม่ถูกต้องให้ปฏิเสธทั้งใบ ไม่ใช่แค่ข้ามรายการนั้น
    for (const it of items) {
        const dateError = validateLotDates(it);
        if (dateError) {
            const err = new Error(dateError);
            err.status = 400;
            throw err;
        }
    }

    const date = receiptDate || todayIso();
    return withTransaction(async () => {
        const receiptNo = await nextDocNumber('RCV', 'receipts', 'receipt_date', date);
        const { lastID: receiptId } = await dbRun(
            `INSERT INTO receipts (receipt_no, receipt_date, requisition_id, note, received_by) VALUES (?, ?, ?, ?, ?)`,
            [receiptNo, date, reqId || null, note || null, receivedBy || null]
        );

        for (const it of items) {
            const qty = Number(it.qty);
            await dbRun(
                `INSERT INTO receipt_items (receipt_id, drug_code, drug_name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit, lot_no, mfg_date, exp_date, qty, unit, unit_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [receiptId, it.drugCode, it.drugName, it.strength || null, it.strengthValue ?? null, it.strengthUnit ?? null, it.packSize || null, it.packSizeValue ?? null, it.packSizeUnit ?? null, it.lotNo,
                    it.mfgDate || null, it.expDate || null, qty, it.unit || null, it.unitCost || null]
            );

            const existingLot = await dbGet(`SELECT * FROM stock_lots WHERE drug_code = ? AND lot_no = ?`, [it.drugCode, it.lotNo]);
            let lotId, balanceAfter;
            if (existingLot) {
                balanceAfter = existingLot.qty_balance + qty;
                await dbRun(`UPDATE stock_lots SET qty_received = qty_received + ?, qty_balance = ?, status = 'active' WHERE id = ?`,
                    [qty, balanceAfter, existingLot.id]);
                lotId = existingLot.id;
            } else {
                const { lastID } = await dbRun(
                    `INSERT INTO stock_lots (drug_code, drug_name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit, lot_no, mfg_date, exp_date, qty_received, qty_balance, unit, unit_cost, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                    [it.drugCode, it.drugName, it.strength || null, it.strengthValue ?? null, it.strengthUnit ?? null, it.packSize || null, it.packSizeValue ?? null, it.packSizeUnit ?? null, it.lotNo,
                        it.mfgDate || null, it.expDate || null, qty, qty, it.unit || null, it.unitCost || null]
                );
                lotId = lastID;
                balanceAfter = qty;
            }

            await dbRun(
                `INSERT INTO stock_movements (drug_code, drug_name, lot_id, lot_no, movement_type, qty_change, balance_after, note, ref_type, ref_id)
                 VALUES (?, ?, ?, ?, 'RECEIPT', ?, ?, ?, 'receipt', ?)`,
                [it.drugCode, it.drugName, lotId, it.lotNo, qty, balanceAfter, note || null, receiptId]
            );

            // ทบยอดรับเข้าใน requisition_items ที่ตรงชนิดยา — ผูกกับ "จำนวนที่จัดส่งมาแล้วจริง" (qty_shipped)
            // ไม่ใช่จำนวนที่เบิกไปทั้งหมด (qty_requested) เพราะถ้าอิงยอดเบิก จะลงรับของที่งานจัดซื้อยังไม่ได้ส่งมาได้จริงๆ
            // (บั๊กเดิม: รายการที่ยังค้างส่งอยู่ที่งานจัดซื้อ แต่ระบบยอมให้ฝั่งคลังลงรับได้เหมือนของมาถึงแล้ว)
            //
            // กฎ: บันทึกรับเข้าคลังอ้างอิงใบเบิกได้ครั้งละใบเท่านั้น และห้ามแก้ไขจำนวนรับเมื่ออ้างอิงใบเบิก —
            // จึงบังคับ 2 ชั้นที่นี่ (เป็นชั้นตัดสินจริง กัน bypass ผ่านการยิง API ตรงๆ ข้ามหน้าเว็บ):
            //   1) ทุกรายการยาที่ส่งมาต้องอยู่ในใบเบิกที่อ้างอิง (reqId) เท่านั้น ห้ามมีรายการนอกใบเบิกปนมา
            //   2) จำนวนที่ส่งมาต้องเท่ากับยอดที่จัดส่งแล้วแต่ยังไม่ได้ลงรับ (qty_shipped - qty_received) พอดีเป๊ะ
            //      ไม่ใช่แค่ไม่เกิน — ป้องกันการพิมพ์จำนวนเองผิดจากยอดที่ระบบคำนวณให้อัตโนมัติ
            if (reqId) {
                const matchingItems = await dbAll(
                    `SELECT * FROM requisition_items WHERE requisition_id = ? AND drug_code = ? ORDER BY id ASC`,
                    [reqId, it.drugCode]
                );
                if (matchingItems.length === 0) {
                    const err = new Error(
                        `${it.drugName} ไม่ได้อยู่ในใบเบิกที่อ้างอิง — บันทึกรับเข้าที่อ้างอิงใบเบิกได้เฉพาะรายการยาที่อยู่ในใบเบิกนั้นเท่านั้น (อ้างอิงใบเบิกได้ครั้งละ 1 ใบ)`
                    );
                    err.status = 400;
                    throw err;
                }
                const availableToReceive = matchingItems.reduce((s, ri) => s + Math.max(0, ri.qty_shipped - ri.qty_received), 0);
                if (Math.abs(qty - availableToReceive) > 1e-9) {
                    const err = new Error(
                        `จำนวนรับเข้าของ ${it.drugName} ต้องเท่ากับจำนวนที่จัดส่งมาแล้วแต่ยังไม่ได้ลงรับพอดี (${availableToReceive} ${it.unit || ''}) — ระบบล็อกจำนวนนี้ให้อัตโนมัติ แก้ไขเองไม่ได้เมื่ออ้างอิงใบเบิก`
                    );
                    err.status = 400;
                    throw err;
                }
                let remaining = qty;
                for (const ri of matchingItems) {
                    if (remaining <= 0) break;
                    const canApply = Math.min(remaining, Math.max(0, ri.qty_shipped - ri.qty_received));
                    if (canApply <= 0) continue;
                    // เช็คยอดคงเหลือจริงใน WHERE เดียวกับ UPDATE (pattern กลาง — ดู concurrency.util.js):
                    // กันกรณีมีคนอื่นลงรับรายการเดียวกันนี้พร้อมกันระหว่าง availableToReceive ที่คำนวณไว้
                    // ข้างบนกับตอนที่ UPDATE จริง — ถ้ายอดไม่พอแล้ว ปฏิเสธทั้งใบทันที (ไม่ apply บางส่วนค้างไว้)
                    await runGuardedUpdate(dbRun,
                        `UPDATE requisition_items SET qty_received = qty_received + ? WHERE id = ? AND (qty_shipped - qty_received) >= ?`,
                        [canApply, ri.id, canApply],
                        `จำนวนที่จัดส่งของ ${it.drugName} มีการเปลี่ยนแปลงโดยผู้ใช้อื่นระหว่างนี้ (อาจมีการลงรับซ้อนกัน) กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง`
                    );
                    remaining -= canApply;
                }
            }
        }

        if (reqId) {
            const allItems = await dbAll(`SELECT * FROM requisition_items WHERE requisition_id = ?`, [reqId]);
            const newStatus = computeStatus(allItems);
            await dbRun(`UPDATE requisitions SET status = ? WHERE id = ?`, [newStatus, reqId]);
        }

        return { id: receiptId, receipt_no: receiptNo };
    }).then(result => {
        eventBus.emit('receipt:created', { id: result.id, receipt_no: result.receipt_no, reqId: reqId || null });
        return result;
    });
}

// รองรับกรองตามช่วงวันที่รับเข้า (from/to, inclusive) และค้นหาเลขที่ใบเบิกที่อ้างอิง (reqNo, partial match)
// reqNo ไม่ได้เก็บอยู่ในตาราง receipts ตรงๆ (มีแค่ requisition_id) จึง LEFT JOIN requisitions มาด้วยเสมอ
// เพื่อทั้งกรองและแสดงเลขที่ใบเบิกอ้างอิงในผลลัพธ์ (source_req_no) — LEFT JOIN เพราะรับเข้าบางรายการไม่ได้อ้างอิงใบเบิก (reqId เป็น null ได้)
async function listReceipts({ from, to, reqNo } = {}) {
    let sql = `SELECT rc.*, req.req_no AS source_req_no
               FROM receipts rc
               LEFT JOIN requisitions req ON req.id = rc.requisition_id
               WHERE 1=1`;
    const params = [];
    if (from) { sql += ` AND rc.receipt_date >= ?`; params.push(from); }
    if (to) { sql += ` AND rc.receipt_date <= ?`; params.push(to); }
    if (reqNo) { sql += ` AND req.req_no LIKE ?`; params.push(`%${reqNo}%`); }
    sql += ` ORDER BY rc.id DESC`;
    const rows = await dbAll(sql, params);
    const out = [];
    for (const r of rows) {
        const items = await dbAll(`SELECT * FROM receipt_items WHERE receipt_id = ?`, [r.id]);
        out.push({ ...r, itemCount: items.length });
    }
    return out;
}

async function getReceipt(id) {
    const r = await dbGet(`SELECT * FROM receipts WHERE id = ?`, [id]);
    if (!r) return null;
    const items = await dbAll(`SELECT * FROM receipt_items WHERE receipt_id = ?`, [id]);
    return { ...r, items };
}

// ---------- ยอดค้างจ่าย (backorder) — รายการที่ยังรับไม่ครบตามที่เบิกไป ----------

async function listBackorders() {
    const rows = await dbAll(
        `SELECT ri.*, r.req_no, r.req_date
         FROM requisition_items ri
         JOIN requisitions r ON r.id = ri.requisition_id
         WHERE ri.qty_received < ri.qty_requested AND r.status != 'cancelled'
         ORDER BY r.req_date ASC`
    );
    return rows.map(r => ({ ...r, qty_outstanding: r.qty_requested - r.qty_received }));
}

// ---------- คลังคงเหลือ ----------

async function listLots({ drugCode, status, onlyAvailable } = {}) {
    const today = todayIso();
    let sql = `SELECT * FROM stock_lots WHERE 1=1`;
    const params = [];
    if (drugCode) { sql += ` AND drug_code = ?`; params.push(drugCode); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (onlyAvailable) { sql += ` AND qty_balance > 0 AND (exp_date IS NULL OR exp_date >= ?)`; params.push(today); }
    sql += ` ORDER BY (exp_date IS NULL), exp_date ASC`;
    const rows = await dbAll(sql, params);
    return rows.map(l => ({ ...l, isExpired: !!l.exp_date && l.exp_date < today }));
}

async function getStockSummary() {
    const today = todayIso();
    const lots = await dbAll(`SELECT * FROM stock_lots ORDER BY drug_code`);
    const byDrug = new Map();
    for (const l of lots) {
        if (!byDrug.has(l.drug_code)) {
            byDrug.set(l.drug_code, {
                drugCode: l.drug_code, drugName: l.drug_name, strength: l.strength,
                strengthValue: l.strength_value, strengthUnit: l.strength_unit,
                packSize: l.pack_size, packSizeValue: l.pack_size_value, packSizeUnit: l.pack_size_unit,
                unit: l.unit, lots: []
            });
        }
        byDrug.get(l.drug_code).lots.push(l);
    }
    const out = [];
    for (const entry of byDrug.values()) {
        const usableLots = entry.lots.filter(l => l.qty_balance > 0 && (!l.exp_date || l.exp_date >= today));
        const expiredLots = entry.lots.filter(l => l.qty_balance > 0 && l.exp_date && l.exp_date < today);
        out.push({
            drugCode: entry.drugCode,
            drugName: entry.drugName,
            strength: entry.strength,
            strengthValue: entry.strengthValue,
            strengthUnit: entry.strengthUnit,
            packSize: entry.packSize,
            packSizeValue: entry.packSizeValue,
            packSizeUnit: entry.packSizeUnit,
            unit: entry.unit,
            usableQty: usableLots.reduce((s, l) => s + l.qty_balance, 0),
            lotCount: entry.lots.filter(l => l.qty_balance > 0).length,
            nearestExp: usableLots.map(l => l.exp_date).filter(Boolean).sort()[0] || null,
            expiredQty: expiredLots.reduce((s, l) => s + l.qty_balance, 0),
            stockValue: entry.lots.reduce((s, l) => s + (l.qty_balance * (l.unit_cost || 0)), 0)
        });
    }
    return out;
}

async function adjustLot({ lotId, qtyChange, reason, user }) {
    const change = Number(qtyChange);
    if (!lotId || !change) {
        const err = new Error('ข้อมูลปรับปรุงยอดไม่ถูกต้อง');
        err.status = 400;
        throw err;
    }
    return withTransaction(async () => {
        const lot = await dbGet(`SELECT * FROM stock_lots WHERE id = ?`, [lotId]);
        if (!lot) {
            const err = new Error('ไม่พบ Lot ที่ระบุ');
            err.status = 404;
            throw err;
        }
        // เงื่อนไข "ยอดหลังปรับต้องไม่ติดลบ" ฝังอยู่ใน WHERE ของ UPDATE เอง (pattern กลาง — ดู
        // concurrency.util.js) แทนที่จะเช็คจาก lot.qty_balance ที่อ่านไว้ก่อนหน้า (ค่าอาจเก่าไปแล้วถ้ามี
        // คนอื่นปรับยอด lot เดียวกันคั่นกลางระหว่างนี้) — WHERE จะประเมินกับยอดจริง ณ เวลาที่เขียนเสมอ
        await runGuardedUpdate(dbRun,
            `UPDATE stock_lots SET qty_balance = qty_balance + ?, status = CASE WHEN qty_balance + ? <= 0 THEN 'depleted' ELSE 'active' END WHERE id = ? AND qty_balance + ? >= 0`,
            [change, change, lotId, change],
            'ยอดคงเหลือของ Lot นี้ถูกผู้ใช้อื่นปรับไปพร้อมกัน ทำให้การปรับครั้งนี้จะทำให้ยอดติดลบ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง'
        );
        const updatedLot = await dbGet(`SELECT * FROM stock_lots WHERE id = ?`, [lotId]);
        await dbRun(`INSERT INTO stock_adjustments (lot_id, qty_change, reason, user) VALUES (?, ?, ?, ?)`,
            [lotId, change, reason || null, user || null]);
        await dbRun(
            `INSERT INTO stock_movements (drug_code, drug_name, lot_id, lot_no, movement_type, qty_change, balance_after, note, ref_type, ref_id)
             VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, 'adjustment', ?)`,
            [lot.drug_code, lot.drug_name, lotId, lot.lot_no, change, updatedLot.qty_balance, reason || null, lotId]
        );
        return { lotId, balanceAfter: updatedLot.qty_balance };
    });
}

async function listMovements({ from, to, drugCode, movementType, limit } = {}) {
    let sql = `SELECT * FROM stock_movements WHERE 1=1`;
    const params = [];
    if (from) { sql += ` AND ts >= ?`; params.push(from); }
    if (to) { sql += ` AND ts <= ?`; params.push(to + ' 23:59:59'); }
    if (drugCode) { sql += ` AND drug_code = ?`; params.push(drugCode); }
    if (movementType) { sql += ` AND movement_type = ?`; params.push(movementType); }
    sql += ` ORDER BY id DESC`;
    if (limit) { sql += ` LIMIT ?`; params.push(Number(limit)); }
    return dbAll(sql, params);
}

async function reportNearExpiry(days = 90) {
    const today = todayIso();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + Number(days));
    const horizonIso = horizon.toISOString().slice(0, 10);
    const rows = await dbAll(
        `SELECT * FROM stock_lots WHERE qty_balance > 0 AND exp_date IS NOT NULL AND exp_date <= ? ORDER BY exp_date ASC`,
        [horizonIso]
    );
    return rows.map(r => ({ ...r, isExpired: r.exp_date < today }));
}

// ---------- ล้างข้อมูลทดสอบ (เฉพาะช่วงทดสอบระบบ) ----------
// ล้างเฉพาะตารางข้อมูลธุรกรรม (ใบเบิก/จัดส่ง/รับเข้า/สต๊อก) — ไม่แตะ drug_master เพราะเป็นข้อมูลอ้างอิง/ตั้งค่า ไม่ใช่ข้อมูลทดสอบ
// ลบตามลำดับลูกก่อนแม่ (ตาราง requisitions เปิด foreign_keys ไว้) แล้วรีเซ็ต auto-increment ให้เริ่มนับใหม่จาก 1
// VACUUM ต้องรันนอก transaction เสมอ (SQLite ไม่อนุญาตให้ VACUUM ระหว่าง BEGIN...COMMIT)
async function clearTestData(password) {
    if (!password || password !== process.env.SUDO_CLEAR_PASSWORD) {
        const err = new Error('รหัสผ่านไม่ถูกต้อง — ไม่ได้รับอนุญาตให้ล้างข้อมูล');
        err.status = 403;
        throw err;
    }
    const tables = [
        'stock_adjustments', 'stock_movements',
        'shipment_items', 'shipments',
        'receipt_items', 'receipts',
        'stock_lots',
        'requisition_items', 'requisitions'
    ];
    await withTransaction(async () => {
        for (const t of tables) {
            await dbRun(`DELETE FROM ${t}`);
            await dbRun(`DELETE FROM sqlite_sequence WHERE name = ?`, [t]);
        }
    });
    await dbRun('VACUUM');
    eventBus.emit('data:cleared', { at: new Date().toISOString(), tables });
    return { cleared: tables };
}

// ---------- ตรวจสอบ/แก้ไขรหัสยาเดิมที่ไม่ตรงรูปแบบ yymmxxx อัตโนมัติ (เฉพาะที่ปลอดภัยจริง) ----------
// หลักการเดียวกับที่เคยใช้ตอนอนุญาตแก้รหัสยาโดยตรง (immutable-once-used): แก้อัตโนมัติได้เฉพาะรหัสที่ยังไม่
// เคยมีธุรกรรมใดๆ อ้างถึงเลย (stock_lots/stock_movements/requisition_items/receipt_items) เท่านั้น — รหัสที่
// เคยใช้แล้วจะไม่ถูกแตะต้องเด็ดขาด ต้องปิดใช้งานรายการเดิม (deleteDrug) แล้วสร้างใหม่ด้วย createDrug() เอง
// (แล้วค่อยลิงก์ด้วย setSupersededBy ถ้าต้องการ) — ดูเหตุผลเต็มที่คอมเมนต์ createDrug ด้านบน
const DRUG_CODE_FORMAT_RE = /^\d{7}$/; // yymmxxx = ตัวเลขล้วน 7 หลัก

async function checkLegacyDrugCodes() {
    const drugs = await dbAll(`SELECT id, drug_code FROM drug_master ORDER BY drug_code`);
    const nonConforming = drugs.filter(d => !DRUG_CODE_FORMAT_RE.test(d.drug_code));
    const safeToFix = [];
    const needsManualMigration = [];
    for (const d of nonConforming) {
        const [lotCount, movementCount, reqItemCount, receiptItemCount] = await Promise.all([
            dbGet(`SELECT COUNT(*) AS c FROM stock_lots WHERE drug_code = ?`, [d.drug_code]),
            dbGet(`SELECT COUNT(*) AS c FROM stock_movements WHERE drug_code = ?`, [d.drug_code]),
            dbGet(`SELECT COUNT(*) AS c FROM requisition_items WHERE drug_code = ?`, [d.drug_code]),
            dbGet(`SELECT COUNT(*) AS c FROM receipt_items WHERE drug_code = ?`, [d.drug_code])
        ]);
        const usageCount = (lotCount?.c || 0) + (movementCount?.c || 0) + (reqItemCount?.c || 0) + (receiptItemCount?.c || 0);
        if (usageCount === 0) safeToFix.push({ id: d.id, oldCode: d.drug_code });
        else needsManualMigration.push({ id: d.id, oldCode: d.drug_code, usageCount });
    }
    return { totalChecked: drugs.length, nonConformingCount: nonConforming.length, safeToFix, needsManualMigration };
}

async function autoFixLegacyDrugCodes() {
    const { safeToFix, needsManualMigration } = await checkLegacyDrugCodes();
    const fixed = [];
    // แก้ทีละรายการ (ไม่ใช่ Promise.all ขนาน) — แต่ละรายการอยู่ใน withTransaction ของตัวเอง ทำให้ generateDrugCode()
    // ของรายการถัดไปนับรวมรหัสที่เพิ่งแก้ในรายการก่อนหน้าไปด้วย ลำดับ xxx จึงต่อเนื่องไม่ชนกันเอง
    for (const item of safeToFix) {
        const row = await withTransaction(async () => {
            const newCode = await generateDrugCode();
            await dbRun(`UPDATE drug_master SET drug_code = ?, version = version + 1 WHERE id = ?`, [newCode, item.id]);
            return dbGet(`SELECT * FROM drug_master WHERE id = ?`, [item.id]);
        });
        fixed.push({ id: item.id, oldCode: item.oldCode, newCode: row.drug_code });
        eventBus.emit('drug:changed', { id: item.id, action: 'code_changed', oldCode: item.oldCode, newCode: row.drug_code });
    }
    return { fixed, skipped: needsManualMigration };
}

module.exports = {
    clearTestData,
    checkpointDatabase,
    checkLegacyDrugCodes,
    autoFixLegacyDrugCodes,
    listLookupOptions,
    createLookupOption,
    updateLookupOption,
    listDrugs,
    createDrug,
    updateDrug,
    setSupersededBy,
    deleteDrug,
    reactivateDrug,
    hardDeleteDrug,
    createRequisition,
    listRequisitions,
    getRequisition,
    cancelRequisition,
    createReceipt,
    listReceipts,
    getReceipt,
    listBackorders,
    listLots,
    getStockSummary,
    adjustLot,
    listMovements,
    reportNearExpiry
};

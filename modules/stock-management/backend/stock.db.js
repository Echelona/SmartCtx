/**
 * stock.db.js — ตรรกะข้อมูลฝั่งงานคลังเคมีบำบัด (1.2 Stock management)
 * ส่งรายการจัดซื้อ (สร้างใบเบิก) ไปให้งานจัดซื้อ (1.1) แล้วรับเข้าตามใบส่งของ — อาจมีค้างจ่าย (partial)
 */

const { dbRun, dbGet, dbAll, withTransaction, nextDocNumber, ready } = require('../../_shared/backend/warehouseSchema.db');
const { CHEMO_DRUG_REFERENCE, LOOKUP_SEED_DATA } = require('../../../shared-data/chemoDrugs.data');
const eventBus = require('../../_shared/backend/eventBus.util');

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

const VALID_LIST_TYPES = ['unit', 'pack_size_unit', 'strength_unit', 'category'];

function assertValidListType(listType) {
    if (!VALID_LIST_TYPES.includes(listType)) {
        const err = new Error(`ประเภทตัวเลือกไม่ถูกต้อง: ${listType}`);
        err.status = 400;
        throw err;
    }
}

async function seedLookupOptionsIfEmpty() {
    await ready;
    for (const listType of VALID_LIST_TYPES) {
        const row = await dbGet(`SELECT COUNT(*) AS c FROM lookup_options WHERE list_type = ?`, [listType]);
        if (row?.c > 0) continue; // มีอยู่แล้ว (อาจถูกแก้ไขโดยผู้ใช้) — ไม่ seed ทับ
        const values = LOOKUP_SEED_DATA[listType] || [];
        await withTransaction(async () => {
            for (const value of values) {
                await dbRun(`INSERT OR IGNORE INTO lookup_options (list_type, value, active) VALUES (?, ?, 1)`, [listType, value]);
            }
        });
    }
    console.log('stock.db: seed ตัวเลือก dropdown เริ่มต้น (หน่วย/ขนาดบรรจุ/หน่วยความแรง/หมวดหมู่) เสร็จแล้ว (ครั้งแรกเท่านั้น)');
}
// รัน seed ทั้งสองชุดตามลำดับเสมอ (ห้ามยิงพร้อมกัน) — sqlite connection เดียวรองรับ transaction ซ้อนกันไม่ได้
// (เจอบั๊กจริง: "cannot start a transaction within a transaction" ตอนสอง seed function เริ่มพร้อมกันแบบไม่ chain)
(async () => {
    try { await seedDrugMasterIfEmpty(); } catch (err) { console.error('seed drug_master ไม่สำเร็จ:', err); }
    try { await seedLookupOptionsIfEmpty(); } catch (err) { console.error('seed lookup_options ไม่สำเร็จ:', err); }
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

async function updateLookupOption(id, { value, active }) {
    const existing = await dbGet(`SELECT * FROM lookup_options WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบตัวเลือกที่ระบุ');
        err.status = 404;
        throw err;
    }
    try {
        await dbRun(
            `UPDATE lookup_options SET value = ?, active = ? WHERE id = ?`,
            [(value ?? existing.value).trim(), active === undefined ? existing.active : (active ? 1 : 0), id]
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

async function createDrug({ drugCode, name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost }) {
    if (!drugCode || !name) {
        const err = new Error('ต้องระบุรหัสยาและชื่อยา');
        err.status = 400;
        throw err;
    }
    const displayStrength = (strengthValue !== undefined && strengthValue !== null && strengthValue !== '')
        ? deriveStrengthDisplay(strengthValue, strengthUnit)
        : (strength || null);
    const displayPackSize = (packSizeValue !== undefined && packSizeValue !== null && packSizeValue !== '')
        ? deriveStrengthDisplay(packSizeValue, packSizeUnit)
        : (packSize || null);
    try {
        const { lastID } = await dbRun(
            `INSERT INTO drug_master (drug_code, name, strength, strength_value, strength_unit, pack_size, pack_size_value, pack_size_unit, category, unit, default_cost, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [drugCode, name, displayStrength, strengthValue || null, strengthUnit || null, displayPackSize, packSizeValue || null, packSizeUnit || null, category || null, unit || null, defaultCost || null]
        );
        const row = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [lastID]);
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

async function updateDrug(id, { name, strength, strengthValue, strengthUnit, packSize, packSizeValue, packSizeUnit, category, unit, defaultCost, active }) {
    const existing = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    if (!existing) {
        const err = new Error('ไม่พบรายการยาที่ระบุ');
        err.status = 404;
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
    await dbRun(
        `UPDATE drug_master SET name = ?, strength = ?, strength_value = ?, strength_unit = ?, pack_size = ?, pack_size_value = ?, pack_size_unit = ?, category = ?, unit = ?, default_cost = ?, active = ? WHERE id = ?`,
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
            id
        ]
    );
    const row = await dbGet(`SELECT * FROM drug_master WHERE id = ?`, [id]);
    eventBus.emit('drug:changed', { id: row.id, action: 'updated' });
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

async function cancelRequisition(id) {
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
    await dbRun(`UPDATE requisitions SET status = 'cancelled' WHERE id = ?`, [id]);
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
            if (reqId) {
                const matchingItems = await dbAll(
                    `SELECT * FROM requisition_items WHERE requisition_id = ? AND drug_code = ? ORDER BY id ASC`,
                    [reqId, it.drugCode]
                );
                if (matchingItems.length > 0) {
                    const availableToReceive = matchingItems.reduce((s, ri) => s + Math.max(0, ri.qty_shipped - ri.qty_received), 0);
                    if (qty > availableToReceive + 1e-9) {
                        const err = new Error(
                            `รับเข้า ${it.drugName} (${qty}) เกินจำนวนที่จัดส่งมาจริง — จัดส่งแล้วแต่ยังไม่ได้ลงรับเพียง ${availableToReceive} ${it.unit || ''} เท่านั้น (ส่วนที่เหลือยังค้างส่งอยู่ที่งานจัดซื้อ)`
                        );
                        err.status = 400;
                        throw err;
                    }
                    let remaining = qty;
                    for (const ri of matchingItems) {
                        if (remaining <= 0) break;
                        const canApply = Math.min(remaining, Math.max(0, ri.qty_shipped - ri.qty_received));
                        if (canApply <= 0) continue;
                        await dbRun(`UPDATE requisition_items SET qty_received = qty_received + ? WHERE id = ?`, [canApply, ri.id]);
                        remaining -= canApply;
                    }
                }
                // matchingItems.length === 0 → ยานี้ไม่ได้อยู่ในใบเบิกที่อ้างอิงเลย ถือเป็นรายการเพิ่มเติมนอกใบเบิก ปล่อยผ่านตามเดิม
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
        const balanceAfter = lot.qty_balance + change;
        if (balanceAfter < 0) {
            const err = new Error('ยอดคงเหลือหลังปรับปรุงติดลบ');
            err.status = 400;
            throw err;
        }
        await dbRun(`UPDATE stock_lots SET qty_balance = ?, status = ? WHERE id = ?`,
            [balanceAfter, balanceAfter <= 0 ? 'depleted' : 'active', lotId]);
        await dbRun(`INSERT INTO stock_adjustments (lot_id, qty_change, reason, user) VALUES (?, ?, ?, ?)`,
            [lotId, change, reason || null, user || null]);
        await dbRun(
            `INSERT INTO stock_movements (drug_code, drug_name, lot_id, lot_no, movement_type, qty_change, balance_after, note, ref_type, ref_id)
             VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, 'adjustment', ?)`,
            [lot.drug_code, lot.drug_name, lotId, lot.lot_no, change, balanceAfter, reason || null, lotId]
        );
        return { lotId, balanceAfter };
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

module.exports = {
    clearTestData,
    listLookupOptions,
    createLookupOption,
    updateLookupOption,
    listDrugs,
    createDrug,
    updateDrug,
    deleteDrug,
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

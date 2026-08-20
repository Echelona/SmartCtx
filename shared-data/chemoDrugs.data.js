/**
 * chemoDrugs.data.js — ข้อมูลอ้างอิงรายการยาเคมีบำบัดที่ใช้บ่อยในโรงพยาบาลไทย
 *
 * แยกฟิลด์ตามที่ต้องใช้คำนวณแยกกันได้:
 *   - name / nameTh          : ชื่อสามัญของยา (item)
 *   - strength                : ข้อความแสดงผลความแรง (เช่น "50 mg") — ใช้แสดงผลเท่านั้น
 *   - strengthValue / strengthUnit : ค่าความแรงแยกเป็นตัวเลข + หน่วย (เช่น 50 กับ "mg")
 *   - packSize                : ข้อความแสดงผลขนาดบรรจุ (เช่น "50 mL/vial") — ใช้แสดงผลเท่านั้น
 *   - packSizeValue / packSizeUnit : ขนาดบรรจุแยกเป็นตัวเลข + หน่วย (เช่น 50 กับ "mL")
 *                                     ยาแบบผงแห้งไม่มีปริมาตรของเหลว จึงไม่มีค่าสองฟิลด์นี้ (undefined)
 *   ทั้งคู่ (strengthValue/Unit และ packSizeValue/Unit) ใช้คำนวณจริงได้ เช่น ความเข้มข้น (mg/mL) =
 *   strengthValue ÷ packSizeValue โดยไม่ต้อง parse ข้อความด้วย regex เอง
 *
 * รายการนี้เป็นจุดเริ่มต้นสำหรับตั้งค่าระบบเท่านั้น ไม่ใช่คำแนะนำทางการแพทย์ —
 * ก่อนใช้งานจริงควรตรวจสอบ/ปรับให้ตรงกับบัญชียาของโรงพยาบาลแต่ละแห่ง (รุ่น/ผู้ผลิต/ขนาดบรรจุอาจต่างกัน)
 */

const CHEMO_DRUG_REFERENCE = [
    { code: 'CISPLATIN-10', name: 'Cisplatin', nameTh: 'ซิสพลาติน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: '10 mL/vial', packSizeValue: 10, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'CISPLATIN-50', name: 'Cisplatin', nameTh: 'ซิสพลาติน', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '50 mL/vial', packSizeValue: 50, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'CARBOPLATIN-150', name: 'Carboplatin', nameTh: 'คาร์โบพลาติน', strength: '150 mg', strengthValue: 150, strengthUnit: 'mg', packSize: '15 mL/vial', packSizeValue: 15, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'CARBOPLATIN-450', name: 'Carboplatin', nameTh: 'คาร์โบพลาติน', strength: '450 mg', strengthValue: 450, strengthUnit: 'mg', packSize: '45 mL/vial', packSizeValue: 45, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'OXALIPLATIN-50', name: 'Oxaliplatin', nameTh: 'ออกซาลิพลาติน', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '10 mL/vial', packSizeValue: 10, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'OXALIPLATIN-100', name: 'Oxaliplatin', nameTh: 'ออกซาลิพลาติน', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: '20 mL/vial', packSizeValue: 20, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'PACLITAXEL-30', name: 'Paclitaxel', nameTh: 'แพคลิแท็กเซล', strength: '30 mg', strengthValue: 30, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'PACLITAXEL-100', name: 'Paclitaxel', nameTh: 'แพคลิแท็กเซล', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: '16.7 mL/vial', packSizeValue: 16.7, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'PACLITAXEL-300', name: 'Paclitaxel', nameTh: 'แพคลิแท็กเซล', strength: '300 mg', strengthValue: 300, strengthUnit: 'mg', packSize: '50 mL/vial', packSizeValue: 50, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'DOCETAXEL-20', name: 'Docetaxel', nameTh: 'โดเซแท็กเซล', strength: '20 mg', strengthValue: 20, strengthUnit: 'mg', packSize: '1 mL/vial', packSizeValue: 1, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'DOCETAXEL-80', name: 'Docetaxel', nameTh: 'โดเซแท็กเซล', strength: '80 mg', strengthValue: 80, strengthUnit: 'mg', packSize: '4 mL/vial', packSizeValue: 4, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'DOXORUBICIN-10', name: 'Doxorubicin', nameTh: 'ด็อกโซรูบิซิน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'DOXORUBICIN-50', name: 'Doxorubicin', nameTh: 'ด็อกโซรูบิซิน', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '25 mL/vial', packSizeValue: 25, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'EPIRUBICIN-10', name: 'Epirubicin', nameTh: 'อีพิรูบิซิน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'EPIRUBICIN-50', name: 'Epirubicin', nameTh: 'อีพิรูบิซิน', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '25 mL/vial', packSizeValue: 25, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'CYCLOPHOS-200', name: 'Cyclophosphamide', nameTh: 'ไซโคลฟอสฟาไมด์', strength: '200 mg', strengthValue: 200, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'CYCLOPHOS-500', name: 'Cyclophosphamide', nameTh: 'ไซโคลฟอสฟาไมด์', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'CYCLOPHOS-1G', name: 'Cyclophosphamide', nameTh: 'ไซโคลฟอสฟาไมด์', strength: '1 g', strengthValue: 1, strengthUnit: 'g', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'IFOSFAMIDE-1G', name: 'Ifosfamide', nameTh: 'ไอฟอสฟาไมด์', strength: '1 g', strengthValue: 1, strengthUnit: 'g', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'IFOSFAMIDE-2G', name: 'Ifosfamide', nameTh: 'ไอฟอสฟาไมด์', strength: '2 g', strengthValue: 2, strengthUnit: 'g', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: '5FU-250', name: '5-Fluorouracil (5-FU)', nameTh: 'ฟลูออโรยูราซิล', strength: '250 mg', strengthValue: 250, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: '5FU-2500', name: '5-Fluorouracil (5-FU)', nameTh: 'ฟลูออโรยูราซิล', strength: '2.5 g', strengthValue: 2.5, strengthUnit: 'g', packSize: '50 mL/vial', packSizeValue: 50, packSizeUnit: 'mL', unit: 'vial' },
    { code: '5FU-5000', name: '5-Fluorouracil (5-FU)', nameTh: 'ฟลูออโรยูราซิล', strength: '5 g', strengthValue: 5, strengthUnit: 'g', packSize: '100 mL/vial', packSizeValue: 100, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'GEMCITABINE-200', name: 'Gemcitabine', nameTh: 'เจมไซตาบีน', strength: '200 mg', strengthValue: 200, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'GEMCITABINE-1G', name: 'Gemcitabine', nameTh: 'เจมไซตาบีน', strength: '1 g', strengthValue: 1, strengthUnit: 'g', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'VINCRISTINE-1', name: 'Vincristine', nameTh: 'วินคริสติน', strength: '1 mg', strengthValue: 1, strengthUnit: 'mg', packSize: '1 mL/vial', packSizeValue: 1, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'VINCRISTINE-2', name: 'Vincristine', nameTh: 'วินคริสติน', strength: '2 mg', strengthValue: 2, strengthUnit: 'mg', packSize: '2 mL/vial', packSizeValue: 2, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'VINBLASTINE-10', name: 'Vinblastine', nameTh: 'วินบลาสติน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: '10 mL/vial', packSizeValue: 10, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'VINORELBINE-10', name: 'Vinorelbine', nameTh: 'วินอเรลบีน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: '1 mL/vial', packSizeValue: 1, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'VINORELBINE-50', name: 'Vinorelbine', nameTh: 'วินอเรลบีน', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'ETOPOSIDE-100', name: 'Etoposide', nameTh: 'อีโทโพไซด์', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'ETOPOSIDE-500', name: 'Etoposide', nameTh: 'อีโทโพไซด์', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', packSize: '25 mL/vial', packSizeValue: 25, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'METHOTREXATE-50', name: 'Methotrexate', nameTh: 'เมโธเทรกเซต', strength: '50 mg', strengthValue: 50, strengthUnit: 'mg', packSize: '2 mL/vial', packSizeValue: 2, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'METHOTREXATE-500', name: 'Methotrexate', nameTh: 'เมโธเทรกเซต', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', packSize: '20 mL/vial', packSizeValue: 20, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'METHOTREXATE-1G', name: 'Methotrexate', nameTh: 'เมโธเทรกเซต', strength: '1 g', strengthValue: 1, strengthUnit: 'g', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'IRINOTECAN-40', name: 'Irinotecan', nameTh: 'อิริโนทีแคน', strength: '40 mg', strengthValue: 40, strengthUnit: 'mg', packSize: '2 mL/vial', packSizeValue: 2, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'IRINOTECAN-100', name: 'Irinotecan', nameTh: 'อิริโนทีแคน', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'BLEOMYCIN-15', name: 'Bleomycin', nameTh: 'บลีโอมัยซิน', strength: '15 unit', strengthValue: 15, strengthUnit: 'unit', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'PEMETREXED-100', name: 'Pemetrexed', nameTh: 'เพเมเทร็กเซด', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'PEMETREXED-500', name: 'Pemetrexed', nameTh: 'เพเมเทร็กเซด', strength: '500 mg', strengthValue: 500, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'CYTARABINE-100', name: 'Cytarabine', nameTh: 'ไซทาราบีน', strength: '100 mg', strengthValue: 100, strengthUnit: 'mg', packSize: '5 mL/vial', packSizeValue: 5, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'CYTARABINE-1G', name: 'Cytarabine', nameTh: 'ไซทาราบีน', strength: '1 g', strengthValue: 1, strengthUnit: 'g', packSize: '10 mL/vial', packSizeValue: 10, packSizeUnit: 'mL', unit: 'vial' },
    { code: 'DAUNORUBICIN-20', name: 'Daunorubicin', nameTh: 'ดอโนรูบิซิน', strength: '20 mg', strengthValue: 20, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'MITOMYCIN-2', name: 'Mitomycin', nameTh: 'ไมโตมัยซิน', strength: '2 mg', strengthValue: 2, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
    { code: 'MITOMYCIN-10', name: 'Mitomycin', nameTh: 'ไมโตมัยซิน', strength: '10 mg', strengthValue: 10, strengthUnit: 'mg', packSize: 'vial (ผงแห้ง)', unit: 'vial' },
];

// ค่าเริ่มต้นสำหรับ dropdown ที่แก้ไข/เพิ่มตัวเลือกเองภายหลังได้ (หน่วย, หน่วยขนาดบรรจุ, หน่วยความแรง, หมวดหมู่)
// ดึงมาจากค่าที่ใช้จริงในรายการยาอ้างอิงด้านบน — seed ให้ครั้งแรกที่ยังไม่มีตัวเลือกในระบบเท่านั้น
const LOOKUP_SEED_DATA = {
    unit: ['vial'],
    pack_size_unit: ['mL'],
    strength_unit: ['g', 'mg', 'unit', 'mcg', 'IU', 'mEq', 'mL'],
    category: ['เคมีบำบัด', 'ยาสนับสนุน (Supportive care)']
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHEMO_DRUG_REFERENCE, LOOKUP_SEED_DATA };
}

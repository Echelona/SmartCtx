// appVersion.shared.js — single source of truth สำหรับเลขเวอร์ชันที่แสดงบนทุกหน้า
// แก้เลขเวอร์ชันที่นี่ที่เดียว ไม่ต้องไล่แก้ทีละไฟล์ HTML
// วิธีใช้: ใส่ <script src="/core/js/shared/appVersion.shared.js"></script> ในหน้าที่ต้องการ
// แล้วใส่ element ว่างๆ ที่มี attribute data-app-version ตรงจุดที่ต้องการให้แสดงเลขเวอร์ชัน เช่น <span data-app-version></span>
window.APP_VERSION = 'V.1.2.0';

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = window.APP_VERSION; });
});

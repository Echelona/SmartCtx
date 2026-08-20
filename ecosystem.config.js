// ecosystem.config.js — ใช้กับ PM2: pm2 start ecosystem.config.js
// รันคำสั่งนี้จาก root ของโปรเจกต์ (โฟลเดอร์เดียวกับ server.js)

module.exports = {
    apps: [{
        name: 'smartctx',
        script: 'server.js',
        cwd: __dirname,
        instances: 1,
        autorestart: true,
        watch: false,           // ไม่ต้อง watch ไฟล์เปลี่ยนอัตโนมัติบน production — restart เองด้วย pm2 restart หลัง deploy
        max_memory_restart: '300M',
        env: {
            // ตั้ง NODE_ENV=production เฉพาะตอนเสิร์ฟผ่าน HTTPS จริงเท่านั้น (ดูรายละเอียดใน DEPLOY.md)
            // ถ้าเสิร์ฟตรงผ่าน HTTP ภายในองค์กร อย่าตั้งเป็น production ไม่งั้น session cookie จะไม่ทำงาน (login ไม่ติด)
            NODE_ENV: 'development'
        }
    }]
};

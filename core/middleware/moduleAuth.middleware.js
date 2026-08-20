/**
 * moduleAuth.middleware.js — สร้างระบบ login แยกต่อโมดูล โดยเช็ค username/password จาก .env
 * ไม่มีตารางผู้ใช้ในฐานข้อมูล — ใช้ค่าคงที่จาก .env ต่อโมดูล ตามที่ระบุไว้ (each module login อยู่ใน .env)
 *
 * ใช้งาน:
 *   const auth = createModuleAuth({ moduleKey: 'procurement', envUser: 'PROCUREMENT_USERNAME', envPass: 'PROCUREMENT_PASSWORD', loginPath: '/modules/procurement/login.html' });
 *   app.post('/modules/procurement/api/auth/login', auth.login);
 *   app.use('/modules/procurement/api', auth.requireAuth, procurementRoutes);
 */

function createModuleAuth({ moduleKey, envUser, envPass, loginPath }) {
    const expectedUser = process.env[envUser];
    const expectedPass = process.env[envPass];

    if (!expectedUser || !expectedPass) {
        console.error(`⚠️  ไม่พบ ${envUser}/${envPass} ใน .env — โมดูล "${moduleKey}" จะ login ไม่ได้จนกว่าจะตั้งค่า`);
    }

    function requireAuth(req, res, next) {
        if (req.session?.moduleAuth?.[moduleKey]) return next();
        // แยกกรณี: เรียก API (อยากได้ JSON error) กับเปิดหน้าเว็บ (อยาก redirect ไป login)
        if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
        }
        return res.redirect(loginPath);
    }

    function login(req, res) {
        const { username, password } = req.body || {};
        if (username && password && username === expectedUser && password === expectedPass) {
            req.session.moduleAuth = req.session.moduleAuth || {};
            req.session.moduleAuth[moduleKey] = true;
            req.session.moduleAuth[`${moduleKey}_user`] = username;
            return res.json({ success: true });
        }
        return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    function logout(req, res) {
        if (req.session?.moduleAuth) {
            delete req.session.moduleAuth[moduleKey];
            delete req.session.moduleAuth[`${moduleKey}_user`];
        }
        res.json({ success: true });
    }

    function status(req, res) {
        res.json({
            authenticated: !!req.session?.moduleAuth?.[moduleKey],
            username: req.session?.moduleAuth?.[`${moduleKey}_user`] || null
        });
    }

    return { requireAuth, login, logout, status };
}

module.exports = { createModuleAuth };

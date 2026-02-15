import jwt from 'jsonwebtoken';

const secret = 'super-secret-key-change-it';
const payload = {
    user_id: '00000000-0000-0000-0000-000000000001',
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365), // 1 year
};

const token = jwt.sign(payload, secret);
console.log(token);

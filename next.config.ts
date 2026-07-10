import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // output: 'standalone',
    /* config options here */
};

module.exports = {
    allowedDevOrigins: [
        '100.116.206.87', // IP từ mạng ảo/VPN
        '192.168.1.5',    // IP Wi-Fi nội bộ
        'localhost',      // Truy cập tại máy local
        '127.0.0.1',       // Loopback IP
        'ferser.tail42fc1b.ts.net'
    ],
}
export default nextConfig;

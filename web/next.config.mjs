import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendUrl = process.env.BACKEND_URL || 'http://localhost:3100';
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`
      },
      {
        source: '/auth/:path*',
        destination: `${backendUrl}/auth/:path*`
      }
    ];
  }
};

export default nextConfig;

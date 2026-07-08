import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.twimg.com',
      },
    ],
  },
  allowedDevOrigins: ['138.25.82.181', '100.115.195.109', 'linux-pc.tail2b9bef.ts.net', 'linux-pc.tail2b9bef.ts.net:3456'],
}

export default nextConfig

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crm/shared', '@crm/ui'],
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    unoptimized: true,
  },
}
module.exports = nextConfig
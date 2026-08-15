/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crm/shared', '@crm/ui'],
  async redirects() {
    return [
      {
        source: '/auth/register',
        destination: '/auth/login',
        permanent: false,
      },
    ]
  },
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

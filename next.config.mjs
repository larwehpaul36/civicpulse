/** @type {import('next').NextConfig} */
const nextConfig = {
  // The preview-image fonts are read from disk at runtime, so make sure Vercel ships them.
  outputFileTracingIncludes: { '/**': ['./lib/fonts/**'] },

  // One public address: the older address forwards to the main one, keeping the page and path.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'civicpulse-nine-lime.vercel.app' }],
        destination: 'https://civicpulse-live.vercel.app/:path*',
        permanent: true,
      },
    ];
  },
};
export default nextConfig;

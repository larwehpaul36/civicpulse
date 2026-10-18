/** @type {import('next').NextConfig} */
const nextConfig = {
  // The preview-image fonts are read from disk at runtime, so make sure Vercel ships them.
  outputFileTracingIncludes: { '/**': ['./lib/fonts/**'] },
};
export default nextConfig;

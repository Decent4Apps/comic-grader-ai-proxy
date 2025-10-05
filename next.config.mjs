/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // App Router assumed
  },
  // Ensure Edge routes work well; no special headers here to avoid gzip confusion
  reactStrictMode: true,
};

export default nextConfig;

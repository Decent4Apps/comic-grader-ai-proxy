/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No output compression override; the gzip issue is on the *upstream* request, which we fixed via Accept-Encoding: identity
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_URL ?? "http://localhost:3001";

const nextConfig = {
  output: "standalone",
  transpilePackages: ["@opspanel/contracts"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

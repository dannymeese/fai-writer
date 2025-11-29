import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "forgetaboutit.ai",
        pathname: "/wp-content/**"
      }
    ]
  }
};

export default nextConfig;


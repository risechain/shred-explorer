/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Ignore the critical dependency warning from @whatwg-node/fetch
    config.module = {
      ...config.module,
      exprContextCritical: false,
    };
    
    return config;
  },
};

module.exports = nextConfig;
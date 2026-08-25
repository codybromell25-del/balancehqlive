import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // Credentials and tokens are decrypted server-side only.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;

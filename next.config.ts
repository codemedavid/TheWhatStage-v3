import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Next dev resources (HMR socket, RSC, etc.) when the app is reached
  // through this ngrok tunnel. Without this, code changes don't reach the
  // browser tab that's loaded over ngrok and you keep seeing stale JS.
  allowedDevOrigins: ["pluckless-jonas-uninclinable.ngrok-free.dev"],
};

export default nextConfig;

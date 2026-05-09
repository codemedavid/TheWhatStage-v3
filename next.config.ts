import type { NextConfig } from "next";

// Stamp every build with a deployment id so stale clients trigger a hard
// reload instead of failing with "Server Action … was not found on the server".
// On Vercel this is auto-injected; locally we fall back to a per-process id.
const deploymentId =
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.NEXT_DEPLOYMENT_ID ??
  process.env.GIT_COMMIT_SHA ??
  (process.env.NODE_ENV === "production" ? undefined : `dev-${process.pid}`);

const nextConfig: NextConfig = {
  // Allow Next dev resources (HMR socket, RSC, etc.) when the app is reached
  // through this ngrok tunnel. Without this, code changes don't reach the
  // browser tab that's loaded over ngrok and you keep seeing stale JS.
  allowedDevOrigins: ["pluckless-jonas-uninclinable.ngrok-free.dev"],
  ...(deploymentId ? { deploymentId } : {}),
};

export default nextConfig;

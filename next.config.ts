import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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

export default withSentryConfig(nextConfig, {
  org: "whatstage",
  project: "javascript-nextjs",

  // Auth token for source map upload during `next build`.
  // Set SENTRY_AUTH_TOKEN (e.g. in .env.sentry-build-plugin) to enable.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of source maps for prettier stack traces (slightly slower builds).
  widenClientFileUpload: true,

  // Route browser → Sentry requests through this Next.js rewrite to circumvent ad-blockers.
  tunnelRoute: "/monitoring",

  // Only print source-map upload logs in CI.
  silent: !process.env.CI,
});

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Fail-fast check: configured chat model is priced AND on an auto-caching
    // provider. Surfaces an env-var regression at boot, before traffic, instead
    // of as a silent $0 ledger or silent cache miss. Non-throwing.
    const { verifyLlmBillingConfig } = await import("./lib/billing/config-check");
    verifyLlmBillingConfig();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors from nested React Server Components (Next.js App Router).
export const onRequestError = Sentry.captureRequestError;

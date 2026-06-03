import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // NOTE: includeLocalVariables is intentionally left OFF (Sentry default).
  // This worker handles service-role tokens and customer PII; attaching local
  // variable values to stack frames would egress secrets/PII to Sentry,
  // bypassing the pipeline's own pii-redact layer. Re-enable only behind a
  // scrubbing beforeSend if frame locals are ever needed for debugging.

  enableLogs: true,
});

// Seed help-center content for the fictional product "Loopwave".
// Embedded into Vectorize by the /api/admin/seed-kb route (see routes.ts),
// then retrieved by the searchKnowledgeBase tool for RAG-grounded replies.

export interface KnowledgeBaseDoc {
  id: string;
  title: string;
  category: string;
  text: string;
}

export const KB_DOCS: KnowledgeBaseDoc[] = [
  {
    id: "kb-billing",
    title: "Billing & Invoices",
    category: "billing",
    text: "Loopwave bills monthly on the date you first subscribed. Invoices are emailed to the account owner and are also available under Settings > Billing > Invoice History. If a card payment fails, we retry twice over 5 days before pausing the workspace; update your card under Settings > Billing > Payment Method to avoid interruption. Refunds for annual plans are prorated if cancelled within the first 30 days; monthly plans are not refunded for partial months."
  },
  {
    id: "kb-login-2fa",
    title: "Login & Two-Factor Authentication",
    category: "login_2fa",
    text: "If you're locked out, use the 'Forgot password' link on the login page to receive a reset email (valid for 30 minutes). For two-factor authentication (2FA) issues, lost authenticator access can be recovered with one of the 10 backup codes generated when 2FA was enabled; if those are also lost, workspace admins can disable 2FA for a user from Settings > Members > Security after verifying identity via the account's billing email."
  },
  {
    id: "kb-api-rate-limits",
    title: "API Rate Limits",
    category: "api_rate_limits",
    text: "The Loopwave API allows 100 requests/minute on the Starter plan, 1,000/minute on Growth, and 10,000/minute on Enterprise. Rate-limited requests return HTTP 429 with a Retry-After header. Limits are per API key, not per workspace, so issuing multiple keys does not increase your effective quota — each key is capped independently at the same plan limit. Sustained 429s are usually a sign a workload should move to the batch export endpoint instead of polling."
  },
  {
    id: "kb-data-export",
    title: "Data Export",
    category: "data_export",
    text: "Full workspace exports (CSV or JSON) can be requested from Settings > Data > Export. Exports are generated asynchronously and emailed as a download link once ready, typically within 15 minutes for workspaces under 1GB and up to a few hours for larger ones. Download links expire after 7 days. Enterprise plans can instead configure a recurring export to an S3-compatible bucket under Settings > Data > Scheduled Exports."
  },
  {
    id: "kb-webhooks",
    title: "Webhooks",
    category: "webhooks",
    text: "Webhooks are configured under Settings > Developer > Webhooks. Loopwave signs every payload with an HMAC-SHA256 signature in the X-Loopwave-Signature header, computed against your endpoint's signing secret. If deliveries are failing, check that your endpoint returns a 2xx within 5 seconds — Loopwave retries failed deliveries up to 5 times with exponential backoff (1m, 5m, 30m, 2h, 6h), then marks the endpoint unhealthy and pauses it after 3 consecutive full-retry failures."
  },
  {
    id: "kb-plan-changes",
    title: "Plan Changes & Upgrades",
    category: "plan_changes",
    text: "You can upgrade or downgrade at any time from Settings > Billing > Plan. Upgrades take effect immediately with a prorated charge for the rest of the billing period. Downgrades take effect at the start of the next billing period so you keep access to your current plan's features until then. Downgrading below your current seat count or usage tier is blocked until you remove the excess members or data first."
  },
  {
    id: "kb-account-deletion",
    title: "Account Deletion",
    category: "account_deletion",
    text: "Workspace owners can request deletion from Settings > Danger Zone > Delete Workspace. This starts a 14-day grace period during which the workspace is deactivated but recoverable by contacting support. After 14 days, all data is permanently and irreversibly deleted, including tickets, exports, and API keys. Deleting a single member's account (not the whole workspace) is immediate and only removes that member's login access, not their historical activity."
  },
  {
    id: "kb-outage-status",
    title: "Outage Status & Incident History",
    category: "outage_status",
    text: "Current system status and incident history are published at status.loopwave.example (placeholder domain for this demo). During an active incident, check there first before opening a ticket — most outage-related tickets can be closed with a link to the relevant incident. Loopwave posts an update at least every 30 minutes during an active incident and a full postmortem within 5 business days of resolution for incidents lasting over 15 minutes."
  }
];

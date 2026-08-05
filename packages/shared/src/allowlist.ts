import type { AllowlistConfig } from "./types.js";

export function isAllowedViewer(email: string, allowlist: AllowlistConfig): boolean {
  const normalized = email.trim().toLowerCase();
  return allowlist.viewers.some((entry) => entry.trim().toLowerCase() === normalized);
}

export const MODERATION_POLICIES = [
  { key: "content.safety", version: 1, name: "Safety and harmful content", category: "safety", severity: "critical" },
  { key: "content.harassment", version: 1, name: "Harassment and abuse", category: "conduct", severity: "high" },
  { key: "content.hate", version: 1, name: "Hateful content", category: "conduct", severity: "critical" },
  { key: "content.sexual", version: 1, name: "Sexual or exploitative content", category: "safety", severity: "critical" },
  { key: "content.copyright", version: 1, name: "Copyright and intellectual property", category: "rights", severity: "medium" },
  { key: "content.spam", version: 1, name: "Spam and deceptive content", category: "integrity", severity: "medium" },
  { key: "content.other", version: 1, name: "Other policy concern", category: "other", severity: "low" },
] as const;

export function findModerationPolicy(key: string) {
  return MODERATION_POLICIES.find((policy) => policy.key === key) ?? null;
}

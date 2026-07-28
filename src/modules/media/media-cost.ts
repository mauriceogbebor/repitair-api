/**
 * Cost intelligence configuration. Background removal is a paid capability, so the
 * admin dashboard needs a defensible per-image unit cost to estimate spend. The
 * unit cost is config-driven (per provider) and provider-agnostic — switching
 * providers only changes the number, never the accounting logic.
 */
const DEFAULT_COST_PER_IMAGE: Record<string, number> = {
  // Indicative list prices (USD). Override per environment via env vars below.
  remove_bg: 0.2,
  clipdrop: 0.1,
  stub: 0,
};

/** Resolve the per-image cost (USD) for a provider from env, falling back to defaults. */
export function costPerImage(provider: string): number {
  const envKey = `MEDIA_COST_PER_IMAGE_${provider.toUpperCase()}`;
  const generic = process.env.MEDIA_COST_PER_IMAGE;
  const specific = process.env[envKey];
  const value = Number(specific ?? generic);
  if (Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_COST_PER_IMAGE[provider] ?? 0;
}

/** Round a currency amount to cents. */
export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

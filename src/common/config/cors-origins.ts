const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://repitair.com",
  "https://www.repitair.com",
];

type CorsEnvironment = Record<string, string | undefined>;

function getOrigin(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function resolveCorsOrigins(
  environment: CorsEnvironment = process.env,
): string[] {
  const configuredOrigins = environment.CORS_ORIGINS
    ? environment.CORS_ORIGINS.split(",")
        .map((origin) => getOrigin(origin))
        .filter((origin): origin is string => Boolean(origin))
    : DEFAULT_CORS_ORIGINS;

  // Hosted authorization pages post back to the API from the API's own origin.
  const serviceOrigins = [
    environment.ADMIN_FRONTEND_ORIGIN,
    environment.PUBLIC_URL,
    environment.API_BASE_URL,
    environment.APPLE_MUSIC_AUTH_BASE_URL,
  ]
    .map((origin) => getOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  return [...new Set([...configuredOrigins, ...serviceOrigins])];
}

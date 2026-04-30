function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required env var "${name}". See .env.example for the full list.`,
    );
  }
  return value.trim();
}

function readOptionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export interface PrintAgentConfig {
  apiOrigin: string;
  locationId: string;
  kdsPassword: string;
}

export function loadConfig(): PrintAgentConfig {
  return {
    apiOrigin: readOptionalEnv("PRINT_AGENT_API_ORIGIN", "http://localhost:3001"),
    locationId: readRequiredEnv("PRINT_AGENT_LOCATION_ID"),
    kdsPassword: readRequiredEnv("PRINT_AGENT_KDS_PASSWORD"),
  };
}

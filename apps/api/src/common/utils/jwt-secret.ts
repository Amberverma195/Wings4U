const DEV_JWT_SECRET = "dev-secret-change-me";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (secret && (!isProduction || secret !== DEV_JWT_SECRET)) {
    return secret;
  }

  if (isProduction) {
    throw new Error(
      "JWT_SECRET must be set to a non-default value in production",
    );
  }

  return DEV_JWT_SECRET;
}

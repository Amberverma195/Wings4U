import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class WebCatalogRevalidationService {
  private readonly logger = new Logger(WebCatalogRevalidationService.name);

  async revalidateLocation(locationId: string): Promise<void> {
    const baseUrl = process.env.WEB_REVALIDATION_URL?.trim().replace(/\/$/, "");
    const secret = process.env.CATALOG_REVALIDATION_SECRET?.trim();

    if (!baseUrl || !secret) {
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/api/revalidate/catalog`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": secret,
        },
        body: JSON.stringify({ locationId }),
      });

      if (!response.ok) {
        this.logger.warn(
          `Next.js catalog revalidation failed for ${locationId}: HTTP ${response.status}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Next.js catalog revalidation failed for ${locationId}: ${(err as Error).message}`,
      );
    }
  }
}

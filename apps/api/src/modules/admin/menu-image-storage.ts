import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

/**
 * Storage adapter interface for menu item images.
 * Swap the implementation to use S3/R2 later without touching the service.
 */
export interface MenuImageStorage {
  /** Save a file buffer and return the public URL path. */
  save(slug: string, buffer: Buffer, originalName: string): Promise<string>;
  /** Remove a previously stored image by its URL path. No-op if the file doesn't exist. */
  remove(imageUrl: string): Promise<void>;
}

/**
 * Stores menu images on the local filesystem under `apps/web/public/uploads/menu/`.
 */
export class LocalMenuImageStorage implements MenuImageStorage {
  private readonly uploadDir: string;
  private readonly urlPrefix = "/uploads/menu/";

  constructor() {
    // Resolve from the compiled dist location back to the web public dir
    this.uploadDir = path.resolve(
      __dirname,
      "../../../../../apps/web/public/uploads/menu",
    );
  }

  async save(
    slug: string,
    buffer: Buffer,
    originalName: string,
  ): Promise<string> {
    await fs.mkdir(this.uploadDir, { recursive: true });

    const uniqueId = crypto.randomBytes(4).toString("hex");
    const ext = path.extname(originalName || ".jpg") || ".jpg";
    const fileName = `${slug}-${uniqueId}${ext}`;
    const fullPath = path.join(this.uploadDir, fileName);

    await fs.writeFile(fullPath, buffer);
    return `${this.urlPrefix}${fileName}`;
  }

  async remove(imageUrl: string): Promise<void> {
    if (!imageUrl || !imageUrl.startsWith(this.urlPrefix)) return;

    const fileName = imageUrl.slice(this.urlPrefix.length);
    // Prevent path traversal
    if (fileName.includes("..") || fileName.includes("/")) return;

    const fullPath = path.join(this.uploadDir, fileName);
    // Verify the resolved path is still inside the upload dir
    if (!fullPath.startsWith(this.uploadDir)) return;

    try {
      await fs.unlink(fullPath);
    } catch {
      // File may already be gone — that's fine.
    }
  }
}

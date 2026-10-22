export const MAX_MENU_IMAGE_BYTES = 4 * 1024 * 1024;
export const MENU_IMAGE_SIZE_MESSAGE = "Image is too large. Choose a PNG, JPEG or WebP image of 4 MiB or smaller.";

export function menuImageFileError(file: Pick<File, "size" | "type">): string | null {
  if (file.size > MAX_MENU_IMAGE_BYTES) return MENU_IMAGE_SIZE_MESSAGE;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Choose a PNG, JPEG or WebP image.";
  return null;
}

export async function menuImageUploadError(response: Response): Promise<string> {
  if (response.status === 413) return MENU_IMAGE_SIZE_MESSAGE;
  const data = await response.json().catch(() => null);
  return data?.errors?.[0]?.message ?? data?.message ?? "Failed to upload image";
}

import { BadRequestException } from "@nestjs/common";

export const MAX_MENU_IMAGE_BYTES = 4 * 1024 * 1024;
export const MENU_IMAGE_UPLOAD_OPTIONS = {
  // Busboy emits file-size/part limits when it reaches the threshold. Allow the inclusive maximum.
  limits: { fileSize: MAX_MENU_IMAGE_BYTES + 1, files: 1, fields: 0, parts: 2 },
  fileFilter: (_request: unknown, file: { mimetype: string }, callback: (error: Error | null, accept: boolean) => void) => {
    const accepted = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    callback(accepted ? null : new BadRequestException("Choose a PNG, JPEG or WebP image"), accepted);
  },
};

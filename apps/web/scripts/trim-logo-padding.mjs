/**
 * Trims transparent padding from logo.png and outputs a square, edge-to-edge favicon asset.
 *
 * Usage: node scripts/trim-logo-padding.mjs
 * Run from apps/web directory.
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, "../public/logo.png");
const OUTPUT_SIZE = 512;

async function trimLogo() {
  console.log("Reading logo from:", LOGO_PATH);

  const originalMeta = await sharp(LOGO_PATH).metadata();
  console.log(
    `Original: ${originalMeta.width}x${originalMeta.height}, format: ${originalMeta.format}`,
  );

  const trimmedBuffer = await sharp(LOGO_PATH).trim({ threshold: 1 }).toBuffer();

  const trimmedMeta = await sharp(trimmedBuffer).metadata();
  console.log(`After trim: ${trimmedMeta.width}x${trimmedMeta.height}`);

  const maxDim = Math.max(trimmedMeta.width, trimmedMeta.height);
  const padTop = Math.floor((maxDim - trimmedMeta.height) / 2);
  const padBottom = maxDim - trimmedMeta.height - padTop;
  const padLeft = Math.floor((maxDim - trimmedMeta.width) / 2);
  const padRight = maxDim - trimmedMeta.width - padLeft;

  const squareBuffer = await sharp(trimmedBuffer)
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  const squareMeta = await sharp(squareBuffer).metadata();
  console.log(`Square canvas: ${squareMeta.width}x${squareMeta.height}`);

  const outputBuffer = await sharp(squareBuffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .png()
    .toBuffer();

  const finalMeta = await sharp(outputBuffer).metadata();
  console.log(`Final output: ${finalMeta.width}x${finalMeta.height}`);

  writeFileSync(LOGO_PATH, outputBuffer);
  console.log("Updated:", LOGO_PATH);
}

trimLogo().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
mkdirSync(publicDir, { recursive: true });

const crc32 = (data) => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const combined = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crc]);
};

const SCALE = 4;
const VIEWBOX_SIZE = 128;
const COLORS = {
  black: [10, 10, 12, 255],
  white: [255, 255, 255, 255],
};

const blendPixel = (pixels, width, x, y, color, opacity = 1) => {
  if (x < 0 || y < 0 || x >= width || y >= width || opacity <= 0) {
    return;
  }

  const offset = (y * width + x) * 4;
  const sourceAlpha = (color[3] / 255) * opacity;
  const destinationAlpha = pixels[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);

  if (outputAlpha === 0) {
    return;
  }

  for (let channel = 0; channel < 3; channel++) {
    pixels[offset + channel] = Math.round(
      (color[channel] * sourceAlpha +
        pixels[offset + channel] *
          destinationAlpha *
          (1 - sourceAlpha)) /
        outputAlpha,
    );
  }
  pixels[offset + 3] = Math.round(outputAlpha * 255);
};

const drawCircle = (pixels, width, centerX, centerY, radius, color) => {
  const minimumX = Math.floor(centerX - radius);
  const maximumX = Math.ceil(centerX + radius);
  const minimumY = Math.floor(centerY - radius);
  const maximumY = Math.ceil(centerY + radius);

  for (let y = minimumY; y <= maximumY; y++) {
    for (let x = minimumX; x <= maximumX; x++) {
      if (Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) <= radius) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }
};

const drawRoundedRectangle = (
  pixels,
  width,
  left,
  top,
  right,
  bottom,
  radius,
  color,
) => {
  for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
    for (let x = Math.floor(left); x < Math.ceil(right); x++) {
      const closestX = Math.max(left + radius, Math.min(x + 0.5, right - radius));
      const closestY = Math.max(top + radius, Math.min(y + 0.5, bottom - radius));

      if (Math.hypot(x + 0.5 - closestX, y + 0.5 - closestY) <= radius) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }
};

const drawLine = (
  pixels,
  width,
  startX,
  startY,
  endX,
  endY,
  strokeWidth,
  color,
) => {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const radius = strokeWidth / 2;
  const minimumX = Math.floor(Math.min(startX, endX) - radius);
  const maximumX = Math.ceil(Math.max(startX, endX) + radius);
  const minimumY = Math.floor(Math.min(startY, endY) - radius);
  const maximumY = Math.ceil(Math.max(startY, endY) + radius);

  for (let y = minimumY; y <= maximumY; y++) {
    for (let x = minimumX; x <= maximumX; x++) {
      const projection = Math.max(
        0,
        Math.min(
          1,
          ((x + 0.5 - startX) * deltaX + (y + 0.5 - startY) * deltaY) /
            lengthSquared,
        ),
      );
      const closestX = startX + projection * deltaX;
      const closestY = startY + projection * deltaY;

      if (Math.hypot(x + 0.5 - closestX, y + 0.5 - closestY) <= radius) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }

  drawCircle(pixels, width, startX, startY, radius, color);
  drawCircle(pixels, width, endX, endY, radius, color);
};

const createArtwork = () => {
  const width = VIEWBOX_SIZE * SCALE;
  const pixels = Buffer.alloc(width * width * 4);
  const scaled = (value) => value * SCALE;
  const lineWidth = scaled(9);
  const armStart = 17;
  const armEnd = 43;
  const oppositeArmStart = VIEWBOX_SIZE - armEnd;
  const oppositeArmEnd = VIEWBOX_SIZE - armStart;

  drawRoundedRectangle(
    pixels,
    width,
    scaled(2),
    scaled(2),
    scaled(126),
    scaled(126),
    scaled(25),
    COLORS.black,
  );

  drawLine(
    pixels,
    width,
    scaled(armStart),
    scaled(64),
    scaled(armEnd),
    scaled(64),
    lineWidth,
    COLORS.white,
  );
  drawLine(
    pixels,
    width,
    scaled(oppositeArmStart),
    scaled(64),
    scaled(oppositeArmEnd),
    scaled(64),
    lineWidth,
    COLORS.white,
  );
  drawLine(
    pixels,
    width,
    scaled(64),
    scaled(armStart),
    scaled(64),
    scaled(armEnd),
    lineWidth,
    COLORS.white,
  );
  drawLine(
    pixels,
    width,
    scaled(64),
    scaled(oppositeArmStart),
    scaled(64),
    scaled(oppositeArmEnd),
    lineWidth,
    COLORS.white,
  );
  drawCircle(pixels, width, scaled(64), scaled(64), scaled(24), COLORS.white);
  drawCircle(pixels, width, scaled(64), scaled(64), scaled(13), COLORS.black);

  return { pixels, width };
};

const resizeArtwork = (artwork, size) => {
  const pixels = Buffer.alloc(size * size * 4);
  const sampleSize = artwork.width / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0];
      const startX = Math.floor(x * sampleSize);
      const endX = Math.floor((x + 1) * sampleSize);
      const startY = Math.floor(y * sampleSize);
      const endY = Math.floor((y + 1) * sampleSize);
      const sampleCount = (endX - startX) * (endY - startY);

      for (let sourceY = startY; sourceY < endY; sourceY++) {
        for (let sourceX = startX; sourceX < endX; sourceX++) {
          const sourceOffset = (sourceY * artwork.width + sourceX) * 4;
          const alpha = artwork.pixels[sourceOffset + 3] / 255;
          totals[0] += artwork.pixels[sourceOffset] * alpha;
          totals[1] += artwork.pixels[sourceOffset + 1] * alpha;
          totals[2] += artwork.pixels[sourceOffset + 2] * alpha;
          totals[3] += alpha;
        }
      }

      const destinationOffset = (y * size + x) * 4;
      const averageAlpha = totals[3] / sampleCount;
      const colorWeight = totals[3] || 1;
      pixels[destinationOffset] = Math.round(totals[0] / colorWeight);
      pixels[destinationOffset + 1] = Math.round(totals[1] / colorWeight);
      pixels[destinationOffset + 2] = Math.round(totals[2] / colorWeight);
      pixels[destinationOffset + 3] = Math.round(averageAlpha * 255);
    }
  }

  return pixels;
};

const createPng = (size, pixels) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;

  const rowSize = 1 + size * 4;
  const raw = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0;
    pixels.copy(raw, y * rowSize + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdrData),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const artwork = createArtwork();

for (const size of [16, 32, 48, 128]) {
  writeFileSync(
    join(publicDir, `icon-${size}.png`),
    createPng(size, resizeArtwork(artwork, size)),
  );
}

console.log("Crosshair icons generated");

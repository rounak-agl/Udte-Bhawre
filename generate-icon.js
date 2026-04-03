// Generate a simple 16x16 PNG tray icon
// This creates a minimal valid PNG file
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const size = 16;

// Build raw image data (filter byte + RGB + A per row)
const rawData = [];
for (let y = 0; y < size; y++) {
  rawData.push(0); // filter: none
  for (let x = 0; x < size; x++) {
    const cx = x - size / 2 + 0.5;
    const cy = y - size / 2 + 0.5;
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist < size / 2 - 1.5) {
      rawData.push(102, 184, 141, 255); // Green circle
    } else if (dist < size / 2 - 0.5) {
      rawData.push(74, 155, 114, 200);  // Anti-aliased edge
    } else {
      rawData.push(0, 0, 0, 0);         // Transparent
    }
  }
}

const rawBuf = Buffer.from(rawData);
const compressed = zlib.deflateSync(rawBuf);

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcData = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// PNG signature
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);  // width
ihdr.writeUInt32BE(size, 4);  // height
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type: RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0))
]);

const outPath = path.join(__dirname, 'assets', 'icon.png');
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(`Icon written to ${outPath} (${png.length} bytes)`);

import fs from 'fs/promises';
import path from 'path';
import {readFile} from 'fs/promises';
import {createHash} from 'crypto';

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.ico',
  '.tif',
  '.tiff'
]);

function getMimeType(file) {
  const ext = path.extname(file).toLowerCase();

  switch (ext) {
  case '.jpg':
  case '.jpeg':
    return 'image/jpeg';

  case '.png':
    return 'image/png';

  case '.gif':
    return 'image/gif';

  case '.webp':
    return 'image/webp';

  case '.bmp':
    return 'image/bmp';

  case '.svg':
    return 'image/svg+xml';

  case '.avif':
    return 'image/avif';

  case '.ico':
    return 'image/vnd.microsoft.icon';

  case '.tif':
  case '.tiff':
    return 'image/tiff';

  default:
    return 'application/octet-stream';
  }
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, {
    withFileTypes: true
  });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(fullPath);
    }
    else if (
      entry.isFile() &&
      IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      yield fullPath;
    }
  }
}

async function hashFile(file, mimeType) {
  const fileBytes = await readFile(file);

  const hash = createHash('sha256');
  hash.update(Buffer.from(mimeType, 'utf8'));
  hash.update(fileBytes);

  return hash.digest('hex');
}

async function buildImageMap(rootDir = '.') {
  const result = {};

  for await (const file of walk(rootDir)) {
    const mime = getMimeType(file);

    const hash = await hashFile(file, mime);

    result[hash] = {
      path: path.relative(rootDir, file).replaceAll(path.sep, '/'),
      mime
    };
  }

  return result;
}

const images = await buildImageMap(process.cwd());

await fs.writeFile(
  'map.json',
  JSON.stringify(images, null, 2)
);

console.log(`Found ${Object.keys(images).length} images`);

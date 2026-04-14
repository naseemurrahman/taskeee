/**
 * Server-side allowlist: images, PDF, Excel only. Blocks executables and risky types.
 */
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv'
]);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.dll', '.js', '.jar', '.ps1', '.vbs', '.sh'
]);

function extname(name) {
  if (!name || typeof name !== 'string') return '';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function magicMatches(buffer, mime) {
  if (!buffer || buffer.length < 4) return false;
  const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3];
  if (mime === 'application/pdf') return buffer.slice(0, 4).toString() === '%PDF';
  if (mime === 'image/jpeg') return b0 === 0xff && b1 === 0xd8;
  if (mime === 'image/png') return b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47;
  if (mime === 'image/gif') return buffer.slice(0, 3).toString() === 'GIF';
  if (mime === 'image/webp') return buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return b0 === 0x50 && b1 === 0x4b; // ZIP / OOXML
  if (mime === 'application/vnd.ms-excel')
    return b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0; // OLE2
  if (mime === 'text/csv' || mime === 'application/csv') {
    const head = buffer.slice(0, Math.min(200, buffer.length)).toString('utf8');
    return !head.includes('\0');
  }
  if (mime === 'image/heic') return b0 === 0x00 && b1 === 0x00 && b2 === 0x00; // loose; HEIC varies
  return true;
}

function assertAllowedFile({ buffer, mimetype, originalname }) {
  const mime = (mimetype || '').toLowerCase();
  const ext = extname(originalname);
  if (BLOCKED_EXTENSIONS.has(ext))
    throw new Error('File type blocked for security');
  if (!ALLOWED_MIMES.has(mime))
    throw new Error('Only images, PDF, and Excel/CSV files are allowed');
  if (!buffer || buffer.length < 4)
    throw new Error('Empty or invalid file');
  if (mime.startsWith('image/')) {
    if (mime === 'image/heic' || mime === 'image/heif') return true;
    if (!magicMatches(buffer, mime))
      throw new Error('File content does not match declared image type');
    return true;
  }
  if (!magicMatches(buffer, mime))
    throw new Error('File content does not match declared type');
  return true;
}

function multerFileFilter(req, file, cb) {
  try {
    const ext = extname(file.originalname);
    if (BLOCKED_EXTENSIONS.has(ext)) return cb(new Error('Executable or script files are not allowed'));
    if (!ALLOWED_MIMES.has((file.mimetype || '').toLowerCase()))
      return cb(new Error('Only images, PDF, and Excel/CSV are allowed'));
    cb(null, true);
  } catch (e) {
    cb(e);
  }
}

module.exports = { assertAllowedFile, multerFileFilter, ALLOWED_MIMES, BLOCKED_EXTENSIONS };

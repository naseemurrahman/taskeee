const { assertAllowedFile } = require('../src/utils/fileSecurity');

describe('fileSecurity', () => {
  test('allows JPEG magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(() => assertAllowedFile({
      buffer: buf,
      mimetype: 'image/jpeg',
      originalname: 'a.jpg'
    })).not.toThrow();
  });

  test('blocks exe by extension', () => {
    expect(() => assertAllowedFile({
      buffer: Buffer.from([0x4d, 0x5a]),
      mimetype: 'application/octet-stream',
      originalname: 'bad.exe'
    })).toThrow();
  });
});

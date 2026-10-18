// Fonts for the generated preview images (Plus Jakarta Sans, SIL Open Font License: see lib/fonts/OFL.txt).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function ogFonts() {
  const dir = join(process.cwd(), 'lib', 'fonts');
  const [bold, regular] = await Promise.all([
    readFile(join(dir, 'PlusJakartaSans-ExtraBold.ttf')),
    readFile(join(dir, 'PlusJakartaSans-Regular.ttf')),
  ]);
  return [
    { name: 'Jakarta', data: regular, weight: 400, style: 'normal' },
    { name: 'Jakarta', data: bold, weight: 800, style: 'normal' },
  ];
}

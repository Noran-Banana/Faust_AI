import fs from 'fs';
import path from 'path';

const srcDir = './assets';
const destDir = './public/assets';

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }

  fs.readdirSync(from).forEach((element) => {
    const stat = fs.lstatSync(path.join(from, element));
    if (stat.isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else if (stat.isDirectory()) {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

try {
  console.log('[Sync] Copying assets to public/assets...');
  copyFolderSync(srcDir, destDir);
  console.log('[Sync] Asset sync complete.');
} catch (err) {
  console.error('[Sync] Error syncing assets:', err);
}

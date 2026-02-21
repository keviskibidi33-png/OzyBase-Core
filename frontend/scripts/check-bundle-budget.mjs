import { promises as fs } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist', 'assets');
const totalBudgetKB = Number(process.env.BUNDLE_BUDGET_KB || 16000);
const maxChunkKB = Number(process.env.BUNDLE_MAX_CHUNK_KB || 7500);

const toKB = (bytes) => Number((bytes / 1024).toFixed(2));

async function main() {
  let entries;
  try {
    entries = await fs.readdir(distDir, { withFileTypes: true });
  } catch (err) {
    console.error(`[bundle-budget] dist assets not found at ${distDir}`);
    process.exit(1);
  }

  const assets = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.css')) continue;
    const filePath = path.join(distDir, entry.name);
    const stat = await fs.stat(filePath);
    assets.push({ name: entry.name, size: stat.size });
  }

  if (assets.length === 0) {
    console.error('[bundle-budget] no JS/CSS assets found in dist/assets');
    process.exit(1);
  }

  const totalBytes = assets.reduce((acc, item) => acc + item.size, 0);
  const largest = assets.reduce((max, item) => (item.size > max.size ? item : max), assets[0]);

  console.log(`[bundle-budget] total: ${toKB(totalBytes)} KB (budget ${totalBudgetKB} KB)`);
  console.log(`[bundle-budget] largest chunk: ${largest.name} (${toKB(largest.size)} KB, budget ${maxChunkKB} KB)`);

  const errors = [];
  if (toKB(totalBytes) > totalBudgetKB) {
    errors.push(`total bundle exceeds budget (${toKB(totalBytes)} KB > ${totalBudgetKB} KB)`);
  }
  if (toKB(largest.size) > maxChunkKB) {
    errors.push(`largest chunk exceeds budget (${toKB(largest.size)} KB > ${maxChunkKB} KB)`);
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      console.error(`[bundle-budget] ${msg}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[bundle-budget] unexpected error', err);
  process.exit(1);
});

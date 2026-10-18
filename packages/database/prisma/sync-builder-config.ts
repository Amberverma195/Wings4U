/** Retired reconciliation command: offline review only. No database access. */
import fs from 'node:fs';
import { planBuilderSync } from './builder-sync-plan.js';

const args = process.argv.slice(2);
let snapshotPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--snapshot') {
    snapshotPath = args[++i];
    if (!snapshotPath || snapshotPath.startsWith('--')) throw new Error('--snapshot requires a local JSON file');
  } else if (args[i] === '--location-code') {
    // Compatibility with the old root NPM command; never selects a DB target.
    if (!args[++i] || args[i].startsWith('--')) throw new Error('--location-code requires a value');
  } else {
    throw new Error('Unsupported argument. Builder sync has no apply, initialize or force mode.');
  }
}
if (!snapshotPath) {
  console.log('Builder sync is offline review only; no database connection or writes. Pass --snapshot <local-catalog.json> for a comparison. Existing restaurants are managed through Admin. Fresh disposable setup uses the strictly guarded Prisma seed.');
} else {
  console.log(JSON.stringify(planBuilderSync(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))), null, 2));
}

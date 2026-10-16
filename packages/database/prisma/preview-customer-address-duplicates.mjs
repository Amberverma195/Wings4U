import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { buildAddressReconciliationPlan, addressPreviewQuery } from './address-reconciliation.mjs';

// Explicit database selection; intentionally never loads .env or uses a fallback URL.
const url = process.env.ADDRESS_RECONCILIATION_DATABASE_URL;
const output = process.argv[2];
if (!url || !output) throw new Error('Set ADDRESS_RECONCILIATION_DATABASE_URL explicitly and pass a new report.json path. This tool only previews.');
const client = new pg.Client({ connectionString:url });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const rows = await client.query(addressPreviewQuery);
  const references = await client.query(`SELECT conname, conrelid::regclass::text AS referencing_table
    FROM pg_constraint WHERE contype='f' AND confrelid='customer_addresses'::regclass`);
  const report = { version:1, mode:'READ_ONLY', generated_at:new Date().toISOString(),
    incoming_references:references.rows, groups:buildAddressReconciliationPlan(rows.rows) };
  await client.query('COMMIT');
  await writeFile(output, JSON.stringify(report,null,2)+'\n', { flag:'wx', mode:0o600 });
  console.log(`Preview only: ${report.groups.length} duplicate groups. Review ${output}. No records changed.`);
} finally { await client.end(); }

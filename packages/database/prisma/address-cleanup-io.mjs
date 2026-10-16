import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { digest } from './customer-address-cleanup.mjs';

/** Exclusive creation prevents overwriting plans, authorizations, audits or existing symlinks. */
export async function writeNewCleanupReport(path, report, { openFile = open } = {}) {
  const file = await openFile(path,'wx',0o600);
  try { await file.writeFile(JSON.stringify(report,null,2)+'\n','utf8'); await file.sync(); }
  finally { await file.close(); }
}

/** Append-only within this process, fsynced JSONL, with sequence/hash chaining. */
export async function createCleanupAudit(path, { openFile = open, runId = randomUUID(), clock = () => new Date() } = {}) {
  const file = await openFile(path,'wx',0o600);
  let sequence=0, previous=null, failed=false, closed=false;
  return {
    async record(event) {
      if (failed || closed) throw new Error('Audit writer unavailable');
      const entry = { ...event, sequence:sequence+1, run_id:runId, at:clock().toISOString(), previous_sha256:previous };
      const line = { ...entry, entry_sha256:digest(entry) };
      try { await file.writeFile(JSON.stringify(line)+'\n','utf8'); await file.sync(); }
      catch(error) { failed=true; throw error; }
      sequence+=1; previous=line.entry_sha256;
    },
    async close() { if (!closed) { closed=true; await file.close(); } },
  };
}

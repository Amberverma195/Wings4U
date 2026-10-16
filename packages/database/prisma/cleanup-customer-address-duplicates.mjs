import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AddressCleanupError, applyCleanup, previewCleanup, validateCleanupAuthorization } from './customer-address-cleanup.mjs';
import { createCleanupAudit, writeNewCleanupReport } from './address-cleanup-io.mjs';

export function parseCleanupArguments(args) {
  const values = {}, booleans = new Set(['--apply','--dry-run','--help']);
  const paths = new Set(['--out','--plan','--authorization','--audit','--confirm-plan-sha256','--confirm-delete-count']);
  for (let i=0;i<args.length;i++) {
    const flag=args[i];
    if ((!booleans.has(flag) && !paths.has(flag)) || Object.hasOwn(values,flag)) throw new AddressCleanupError('INVALID_ARGUMENTS','Unknown or repeated cleanup argument.');
    if (booleans.has(flag)) values[flag]=true;
    else {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new AddressCleanupError('INVALID_ARGUMENTS','A cleanup argument is missing its value.');
      values[flag]=args[++i];
    }
  }
  if (values['--help']) return {help:true};
  if (values['--apply'] && values['--dry-run']) throw new AddressCleanupError('INVALID_ARGUMENTS','Choose either dry-run or apply mode.');
  if (!values['--apply']) {
    if (!values['--out'] || [...paths].filter(flag=>flag!=='--out').some(flag=>values[flag])) {
      throw new AddressCleanupError('READ_ONLY_DEFAULT','Default mode only previews. Supply --out; destructive arguments require explicit --apply.');
    }
    return {mode:'dry-run',out:values['--out']};
  }
  if (values['--out'] || [...paths].filter(flag=>flag!=='--out').some(flag=>!values[flag]) ||
    !/^[0-9a-f]{64}$/.test(values['--confirm-plan-sha256']) || !/^[1-9]\d*$/.test(values['--confirm-delete-count'])) {
    throw new AddressCleanupError('APPLY_FLAGS_REQUIRED','Apply requires a reviewed plan, separate authorization, new audit path, exact checksum and positive deletion count.');
  }
  const count=Number(values['--confirm-delete-count']);
  if (!Number.isSafeInteger(count)) throw new AddressCleanupError('COUNT_MISMATCH','Deletion count must be a safe integer.');
  if (new Set([values['--plan'],values['--authorization'],values['--audit']].map(path=>resolve(path))).size!==3) {
    throw new AddressCleanupError('SEPARATE_ARTIFACTS_REQUIRED','Plan, authorization and audit must use separate files.');
  }
  return {mode:'apply',plan:values['--plan'],authorization:values['--authorization'],audit:values['--audit'],
    confirmHash:values['--confirm-plan-sha256'],confirmCount:count};
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch { throw new AddressCleanupError('INVALID_REVIEW_FILE','A review file could not be read as JSON. No database action was started.'); }
}
const usage = 'Review-only tool. Default: --out NEW_PLAN.json. Future separately authorized apply: --apply --plan PLAN.json --authorization APPROVAL.json --audit NEW_AUDIT.jsonl --confirm-plan-sha256 HASH --confirm-delete-count COUNT. No approval file is generated automatically.';

/** Imported safely by tests: the CLI entry point is guarded below and never runs on import. */
export async function runCleanupCli({ args, env, createClient, readReviewFile=readJson,
  auditFactory=createCleanupAudit, writeReport=writeNewCleanupReport, log=console.log, clock=()=>new Date() }) {
  const options=parseCleanupArguments(args);
  if (options.help) { log(usage); return {status:'help'}; }
  const connectionString=env.ADDRESS_RECONCILIATION_DATABASE_URL;
  let url;
  try { url=new URL(connectionString); } catch { /* Explicit URL required. */ }
  if (!url || !['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length<2) {
    throw new AddressCleanupError('DATABASE_URL_REQUIRED','Set ADDRESS_RECONCILIATION_DATABASE_URL explicitly. No .env or fallback database is used.');
  }
  let plan,authorization,audit,client,primaryError,completed;
  // Reject missing/forged/expired authorization before constructing a database client.
  if (options.mode==='apply') {
    plan=await readReviewFile(options.plan); authorization=await readReviewFile(options.authorization);
    validateCleanupAuthorization({plan,authorization,confirmHash:options.confirmHash,confirmCount:options.confirmCount,now:clock()});
    audit=await auditFactory(options.audit);
  }
  try {
    if (!createClient) {
      const {default:pg}=await import('pg');
      createClient=config=>new pg.Client(config);
    }
    client=createClient({connectionString,connectionTimeoutMillis:5000,application_name:'wings4u_address_cleanup_review',
      ...(options.mode==='dry-run'?{options:'-c default_transaction_read_only=on'}:{})});
    await client.connect();
    if (options.mode==='dry-run') {
      // Connection poolers such as Supabase Supavisor drop the startup `options` parameter.
      await client.query('SET SESSION default_transaction_read_only=on');
      const report=await previewCleanup(client,clock()); await writeReport(options.out,report);
      log(`Read-only preview: ${report.counts.duplicate_groups} duplicate groups; ${report.counts.blocked_groups} blocked groups; ${report.blockers.length} schema/reference blockers. Report saved. No records changed.`);
      return {status:'dry-run',report};
    }
    const result=await applyCleanup({client,plan,authorization,confirmHash:options.confirmHash,
      confirmCount:options.confirmCount,audit,clock});
    completed=result;
    log(`Committed ${result.deleted_count} explicitly authorized duplicate address deletions. Review the audit before any further execution.`);
    return result;
  } catch(error) { primaryError=error; throw error; }
  finally {
    const closeErrors=[];
    try { if(client) await client.end(); } catch(error) { closeErrors.push(error); }
    try { if(audit) await audit.close(); } catch(error) { closeErrors.push(error); }
    if (closeErrors.length && !primaryError) throw new AddressCleanupError(completed?.status==='committed'?'POST_COMMIT_CLOSE_FAILED':'RESOURCE_CLOSE_FAILED',
      completed?.status==='committed'?'Database commit succeeded, but closing the connection/audit failed. Do not retry; review the audit.':'Cleanup resources could not be closed cleanly. Review the audit before any further action.');
  }
}

export function cleanupErrorMessage(error) {
  if (error instanceof AddressCleanupError) return `${error.code}: ${error.message}`;
  const code=typeof error?.code==='string' && /^[A-Z0-9_]+$/.test(error.code)?error.code:'UNKNOWN';
  return `CLEANUP_FAILED (${code}): No automatic retry was attempted. Check the secure audit and database state before any further action.`;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runCleanupCli({args:process.argv.slice(2),env:process.env}).catch(error=>{console.error(cleanupErrorMessage(error));process.exitCode=1;});
}

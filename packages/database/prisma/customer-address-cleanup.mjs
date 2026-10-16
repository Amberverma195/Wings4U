import { createHash } from 'node:crypto';
import { buildAddressReconciliationPlan } from './address-reconciliation.mjs';

export class AddressCleanupError extends Error {
  constructor(code, message) { super(message); this.name = 'AddressCleanupError'; this.code = code; }
}
const fail = (code, message) => { throw new AddressCleanupError(code, message); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const expectedColumns = ['id','user_id','line1','city','postal_code','label','is_default','created_at','updated_at','canonical_key'];
const sortRows = rows => [...rows].sort((a,b) => a.id.localeCompare(b.id));
const sortedIds = ids => [...ids].sort();
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const same = (a,b) => digest(a) === digest(b);

export const inspectionSql = {
  target: `/* address-cleanup:target */ SELECT current_database() AS database,
    'public'::text AS schema, 'customer_addresses'::text AS table,
    'public.customer_addresses'::regclass::oid::text AS table_oid,
    inet_server_addr()::text AS server_address, inet_server_port() AS server_port`,
  columns: `/* address-cleanup:columns */ SELECT attname AS name, format_type(atttypid,atttypmod) AS type,
    attnotnull AS not_null FROM pg_attribute WHERE attrelid='public.customer_addresses'::regclass
    AND attnum>0 AND NOT attisdropped ORDER BY attnum`,
  references: `/* address-cleanup:references */ SELECT conname AS name,
    conrelid::regclass::text AS referencing_table, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype='f' AND confrelid='public.customer_addresses'::regclass ORDER BY conname, conrelid`,
  triggers: `/* address-cleanup:triggers */ SELECT t.tgname AS name, t.tgenabled AS enabled,
    n.nspname AS function_schema, p.proname AS function_name,
    p.prosecdef AS security_definer,
    pg_get_triggerdef(t.oid) AS definition, pg_get_functiondef(p.oid) AS function_definition
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid='public.customer_addresses'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`,
  indexes: `/* address-cleanup:indexes */ SELECT c.relname AS name, i.indisunique AS is_unique,
    i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.customer_addresses'::regclass ORDER BY c.relname`,
  table: `/* address-cleanup:table */ SELECT relkind AS kind, relrowsecurity AS row_security,
    relforcerowsecurity AS force_row_security FROM pg_class WHERE oid='public.customer_addresses'::regclass`,
  rules: `/* address-cleanup:rules */ SELECT rulename AS name, pg_get_ruledef(oid) AS definition
    FROM pg_rewrite WHERE ev_class='public.customer_addresses'::regclass ORDER BY rulename`,
  identity_function: `/* address-cleanup:identity_function */ SELECT p.proname AS name,
    p.provolatile AS volatility,p.prosecdef AS security_definer,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname='wings4u_address_key' AND p.proargtypes='25 25 25'::oidvector ORDER BY p.oid`,
};

const identitySql = `jsonb_build_array(
  lower(trim(regexp_replace(normalize(line1,NFKC),'[[:space:]]+',' ','g'))),
  lower(trim(regexp_replace(normalize(city,NFKC),'[[:space:]]+',' ','g'))),
  lower(regexp_replace(normalize(postal_code,NFKC),'[[:space:]]+','','g'))
)::text`;
function rowProjection(hasKey) {
  return `id,user_id,line1,city,postal_code,label,is_default,created_at::text,updated_at::text,
    ${hasKey ? 'canonical_key' : 'NULL::text AS canonical_key'}, ${identitySql} AS identity`;
}
async function inspect(client) {
  // Sequential queries keep a single transaction snapshot and support pg.Client.
  const state = {};
  for (const [key, sql] of Object.entries(inspectionSql)) state[key] = (await client.query(sql)).rows;
  if (state.target.length !== 1 || state.table.length !== 1) fail('INVALID_TARGET','The public address table could not be inspected.');
  return { target: state.target[0], schema: Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'target')) };
}
function schemaBlockers(schema) {
  const blockers = [];
  const names = schema.columns.map(column => column.name);
  if (names.some(name => !expectedColumns.includes(name)) || expectedColumns.some(name => !names.includes(name))) {
    blockers.push('The address columns differ from the supported migrated schema; review metadata before cleanup.');
  }
  if (schema.references.length) blockers.push('Incoming foreign-key references exist. Cleanup does not delete or reassign referenced records.');
  if (schema.table[0]?.kind !== 'r' || schema.table[0]?.row_security || schema.table[0]?.force_row_security) {
    blockers.push('Partitioned/nonstandard tables or row-level security require separate review.');
  }
  if (schema.rules.length) blockers.push('Unexpected database rules require review.');
  if (schema.triggers.length !== 1 || schema.triggers[0].name !== 'guard_customer_address_identity' ||
    schema.triggers[0].enabled !== 'O' || schema.triggers[0].function_schema !== 'public' ||
    schema.triggers[0].function_name !== 'wings4u_guard_customer_address' || schema.triggers[0].security_definer) {
    blockers.push('The expected enabled address-identity trigger must be the only user trigger.');
  }
  if (schema.identity_function.length !== 1 || schema.identity_function[0].volatility !== 'i' || schema.identity_function[0].security_definer) {
    blockers.push('The expected immutable, invoker-security identity function must be installed.');
  }
  if (!schema.indexes.some(index => index.name === 'uq_customer_addresses_canonical' && index.is_unique && index.valid &&
    /\(user_id, canonical_key\)/.test(index.definition))) blockers.push('The canonical unique index is missing or invalid.');
  return blockers;
}
async function readRows(client, schema, users, lock = false) {
  const hasKey = schema.columns.some(column => column.name === 'canonical_key');
  return (await client.query(`/* address-cleanup:rows */ SELECT ${rowProjection(hasKey)} FROM public.customer_addresses
    ${users ? 'WHERE user_id=ANY($1::uuid[])' : ''} ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, users ? [users] : [])).rows;
}
function scopeHashes(rows, users) {
  return Object.fromEntries(sortedIds(users).map(user => [user,digest(sortRows(rows.filter(row => row.user_id === user)))]));
}
function groupsWithActions(rows) {
  return buildAddressReconciliationPlan(rows).map(group => ({ ...group,
    proposed_after: { ...group.members.find(row => row.id === group.recommended_keep_id),
      label: group.recommended_label, is_default: group.members.some(row => row.is_default) },
    blocked: group.requires_label_review || group.members.some(row => !row.line1.trim() || !row.city.trim() || !row.postal_code.trim()),
  }));
}

/** Pure planning; no connection creation and no mutations. */
export function createCleanupPlan({ rows, target, schema, now = new Date() }) {
  const groups = groupsWithActions(rows);
  const users = [...new Set(groups.map(group => group.user_id))];
  const plan = { version:2, mode:'DRY_RUN', generated_at:now.toISOString(), target, schema,
    blockers:schemaBlockers(schema), groups, scope_hashes:scopeHashes(rows,users),
    counts:{ duplicate_groups:groups.length, proposed_deletions:groups.reduce((n,group) => n+group.duplicate_ids.length,0),
      blocked_groups:groups.filter(group => group.blocked).length },
    preservation:'Retain canonical IDs, street/unit, city, postal text and created_at. Preserve defaults and transfer an unambiguous label. Audit all before/after metadata. Never alter orders or customer accounts.',
  };
  return { ...plan, plan_sha256:digest(plan) };
}

export async function previewCleanup(client, now = new Date()) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const {target,schema} = await inspect(client);
    const plan = createCleanupPlan({rows:await readRows(client,schema),target,schema,now});
    await client.query('COMMIT'); return plan;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}

/** Approval is a separate operator-created artifact. This module never generates it. */
export function validateCleanupAuthorization({ plan, authorization, confirmHash, confirmCount, now = new Date() }) {
  if (!plan || plan.version !== 2 || plan.mode !== 'DRY_RUN' || !Array.isArray(plan.groups) ||
    !Array.isArray(plan.blockers) || !plan.scope_hashes || !plan.schema ||
    !['columns','references','triggers','indexes','table','rules','identity_function'].every(key=>Array.isArray(plan.schema[key]))) {
    fail('INVALID_PLAN','A complete version 2 dry-run plan is required.');
  }
  const {plan_sha256,...content} = plan;
  if (digest(content) !== plan_sha256 || confirmHash !== plan_sha256) fail('PLAN_HASH_MISMATCH','The reviewed plan checksum does not match.');
  if (!authorization || authorization.version !== 1 || authorization.plan_sha256 !== plan_sha256 ||
    authorization.authorization !== 'DELETE_ONLY_REVIEWED_DUPLICATE_CUSTOMER_ADDRESSES' ||
    typeof authorization.approved_by !== 'string' || !authorization.approved_by.trim() ||
    !same(authorization.target,plan.target)) fail('MISSING_AUTHORIZATION','Separate explicit authorization tied to this plan and target is required.');
  const approved = Date.parse(authorization.approved_at), expires = Date.parse(authorization.expires_at);
  if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now.getTime() ||
    expires <= now.getTime() || expires <= approved || expires-approved > 86400000) {
    fail('EXPIRED_AUTHORIZATION','Authorization must be current, dated, and valid for no more than 24 hours.');
  }
  if (!Array.isArray(authorization.groups) || !authorization.groups.length) fail('EMPTY_SELECTION','Explicit reviewed address IDs are required.');
  const selected = [], seen = new Set();
  for (const selection of authorization.groups) {
    if (!selection || typeof selection !== 'object' || !uuid.test(selection.keep_id) || !Array.isArray(selection.delete_ids) || !selection.delete_ids.length ||
      !selection.delete_ids.every(id => uuid.test(id))) fail('INVALID_SELECTION','Authorization must contain exact address UUIDs.');
    const group = plan.groups.find(group => group.recommended_keep_id === selection.keep_id);
    if (!group || !same(sortedIds(selection.delete_ids),sortedIds(group.duplicate_ids)) || group.blocked) {
      fail('UNSAFE_SELECTION','Selected IDs must exactly match an unblocked recommended duplicate group.');
    }
    for (const id of [selection.keep_id,...selection.delete_ids]) {
      if (seen.has(id)) fail('REPEATED_ID','An address ID appears more than once in authorization.');
      seen.add(id);
    }
    selected.push(group);
  }
  if (plan.blockers.length || schemaBlockers(plan.schema).length) fail('SCHEMA_BLOCKED','The dry run reports schema/reference blockers; resolve them before applying.');
  const deletionCount = selected.reduce((n,group) => n+group.duplicate_ids.length,0);
  if (!Number.isSafeInteger(confirmCount) || confirmCount !== deletionCount || authorization.delete_count !== deletionCount) {
    fail('COUNT_MISMATCH','The authorization and explicit deletion count must match the reviewed IDs.');
  }
  return selected;
}

/** Review-only until a future, separately authorized invocation. Injected clients make tests database-free. */
export async function applyCleanup({ client, plan, authorization, confirmHash, confirmCount, audit, clock = () => new Date() }) {
  const groups = validateCleanupAuthorization({plan,authorization,confirmHash,confirmCount,now:clock()});
  if (!audit || typeof audit.record !== 'function') fail('AUDIT_REQUIRED','A durable audit writer is required.');
  const users = sortedIds([...new Set(groups.map(group => group.user_id))]);
  const requireCurrentApproval = () => {
    if (clock().getTime() >= Date.parse(authorization.expires_at)) fail('EXPIRED_AUTHORIZATION','Authorization expired before completion; rolling back.');
  };
  let started=false, commitAttempted=false, committed=false;
  await audit.record({event:'prepared',plan_sha256:plan.plan_sha256,target:plan.target,authorization,groups});
  try {
    await client.query('BEGIN'); started=true;
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    if (!same((await client.query(inspectionSql.target)).rows[0],plan.target)) {
      fail('TARGET_MISMATCH','The connected database is not the reviewed target. No locks were taken; generate a plan for this database.');
    }
    for (const user of users) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,84542))',[user]);
    // Readers continue; writers/DDL are held during the short audited transaction.
    await client.query('LOCK TABLE public.customer_addresses IN SHARE ROW EXCLUSIVE MODE');
    const current = await inspect(client);
    if (!same(current.target,plan.target) || !same(current.schema,plan.schema) || schemaBlockers(current.schema).length) {
      fail('SCHEMA_CHANGED','The database target, schema or references changed after review. Generate a fresh plan.');
    }
    const rows = await readRows(client,current.schema,users,true);
    const hashes = scopeHashes(rows,users);
    if (users.some(user => hashes[user] !== plan.scope_hashes[user])) fail('STALE_PLAN','An affected address book changed after preview. Generate a fresh plan.');
    const actualGroups = groupsWithActions(rows);
    for (const group of groups) {
      if (!same(group,actualGroups.find(actual => actual.recommended_keep_id === group.recommended_keep_id))) {
        fail('STALE_GROUP','The reviewed duplicate group no longer matches the database.');
      }
    }
    let expected = sortRows(rows);
    for (const group of groups) {
      requireCurrentApproval();
      await audit.record({event:'group_before',transaction_state:'uncommitted',group});
      requireCurrentApproval();
      const removed = (await client.query(`/* address-cleanup:delete */ DELETE FROM public.customer_addresses
        WHERE user_id=$1::uuid AND id=ANY($2::uuid[]) AND ${identitySql}=$3
        RETURNING ${rowProjection(true)}`,[group.user_id,group.duplicate_ids,group.identity])).rows;
      if (!same(sortRows(removed),sortRows(group.members.filter(row => row.id !== group.recommended_keep_id)))) {
        fail('DELETE_MISMATCH','Deleted records did not exactly match the reviewed snapshots; rolling back.');
      }
      requireCurrentApproval();
      const after = (await client.query(`/* address-cleanup:retain */ UPDATE public.customer_addresses
        SET label=$1,is_default=$2,updated_at=CASE WHEN label IS DISTINCT FROM $1 OR is_default IS DISTINCT FROM $2
          THEN GREATEST(updated_at,now()) ELSE updated_at END
        WHERE id=$3::uuid AND user_id=$4::uuid RETURNING ${rowProjection(true)}`,
        [group.recommended_label,group.proposed_after.is_default,group.recommended_keep_id,group.user_id])).rows;
      if (after.length !== 1) fail('KEEPER_MISSING','The canonical address could not be retained; rolling back.');
      const preserved = ['id','user_id','line1','city','postal_code','created_at','identity'];
      const before = group.members.find(row => row.id === group.recommended_keep_id);
      if (preserved.some(key => after[0][key] !== before[key]) || after[0].label !== group.recommended_label ||
        after[0].is_default !== group.proposed_after.is_default || after[0].canonical_key !== group.identity) {
        fail('METADATA_MISMATCH','Canonical address metadata did not match the reviewed result; rolling back.');
      }
      expected = expected.filter(row => !group.duplicate_ids.includes(row.id)).map(row => row.id === after[0].id ? after[0] : row);
      await audit.record({event:'group_after',transaction_state:'uncommitted',removed,retained:after[0]});
    }
    if (!same(sortRows(await readRows(client,current.schema,users)),sortRows(expected))) {
      fail('FINAL_STATE_MISMATCH','Unexpected address changes were detected; rolling back.');
    }
    requireCurrentApproval();
    await audit.record({event:'commit_requested',transaction_state:'uncommitted',deleted_count:confirmCount});
    requireCurrentApproval();
    commitAttempted=true; await client.query('COMMIT'); committed=true;
    await audit.record({event:'committed',deleted_count:confirmCount,retained_ids:groups.map(group => group.recommended_keep_id)});
    return {status:'committed',deleted_count:confirmCount,retained_ids:groups.map(group => group.recommended_keep_id)};
  } catch(error) {
    if (committed) fail('AUDIT_FINALIZATION_FAILED','Database commit succeeded, but its final audit entry failed. Do not retry; reconcile the durable audit with the database.');
    if (commitAttempted) {
      try { await audit.record({event:'commit_outcome_unknown',code:'COMMIT_OUTCOME_UNKNOWN'}); } catch { /* Preserve original uncertainty. */ }
      fail('COMMIT_OUTCOME_UNKNOWN','Commit acknowledgement failed. Do not retry. Reconcile the audit and database before any further action.');
    }
    if (started) {
      try { await client.query('ROLLBACK'); }
      catch { fail('ROLLBACK_UNCONFIRMED','Rollback could not be confirmed. Close the connection and reconcile the audit/database before retrying.'); }
      try { await audit.record({event:'rolled_back',code:error instanceof AddressCleanupError ? error.code : 'DATABASE_OR_AUDIT_ERROR'}); }
      catch { fail('ROLLBACK_AUDIT_FAILED','Database rollback succeeded but audit reporting failed. Preserve the existing audit for review.'); }
    }
    throw error;
  }
}

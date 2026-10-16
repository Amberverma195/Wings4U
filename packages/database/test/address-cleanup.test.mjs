import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleanupPlan, validateCleanupAuthorization, previewCleanup, applyCleanup, digest } from '../prisma/customer-address-cleanup.mjs';
import { parseCleanupArguments, runCleanupCli, cleanupErrorMessage } from '../prisma/cleanup-customer-address-duplicates.mjs';
import { createCleanupAudit, writeNewCleanupReport } from '../prisma/address-cleanup-io.mjs';

// Review-only tests: all clients and file handles below are JavaScript fakes.
// No PostgreSQL engine, CLI entry point, connection, migration or real database is executed.
const NOW=new Date('2026-10-16T12:00:00Z');
const USER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const target={database:'isolated_review_fixture',schema:'public',table:'customer_addresses',table_oid:'123',server_address:'127.0.0.1',server_port:5432};
const schema={
  columns:['id','user_id','line1','city','postal_code','label','is_default','created_at','updated_at','canonical_key'].map(name=>({name,type:'fixture',not_null:name!=='canonical_key'})),
  references:[],triggers:[{name:'guard_customer_address_identity',enabled:'O',function_schema:'public',function_name:'wings4u_guard_customer_address',definition:'known trigger',function_definition:'reviewed function'}],
  indexes:[{name:'uq_customer_addresses_canonical',is_unique:true,valid:true,definition:'CREATE UNIQUE INDEX uq_customer_addresses_canonical ON public.customer_addresses USING btree (user_id, canonical_key)'}],
  table:[{kind:'r',row_security:false,force_row_security:false}],rules:[],
  identity_function:[{name:'wings4u_address_key',volatility:'i',security_definer:false,definition:'reviewed identity function'}],
};
const address=(id,extra={})=>({id,user_id:USER,line1:'100 Example Street unit 111',city:'Test City',postal_code:'N0A1B2',label:null,is_default:false,
  created_at:'2026-07-01 12:00:00.000001+00',updated_at:'2026-07-01 12:00:00.000002+00',canonical_key:null,identity:'unit-111',...extra});
const initialRows=()=>[address(A,{is_default:true}),address(B,{label:'Home',postal_code:'N5Y 4J7'}),
  address(C,{line1:'100 Example Street unit 112',identity:'unit-112'}),address(D,{user_id:OTHER})];
const planFor=(rows=initialRows(),overrides={})=>createCleanupPlan({rows,target:structuredClone(target),schema:structuredClone(schema),now:NOW,...overrides});
const approvalFor=plan=>({version:1,plan_sha256:plan.plan_sha256,target:structuredClone(plan.target),approved_by:'Fixture reviewer',
  approved_at:'2026-10-16T11:59:00Z',expires_at:'2026-10-16T13:00:00Z',authorization:'DELETE_ONLY_REVIEWED_DUPLICATE_CUSTOMER_ADDRESSES',
  delete_count:1,groups:[{keep_id:A,delete_ids:[B]}]});
const code=expected=>error=>error.code===expected;
const authorizationOptions=(plan,authorization=approvalFor(plan))=>({plan,authorization,confirmHash:plan.plan_sha256,confirmCount:1,now:NOW});
function fakeAudit(failEvent) {
  return {events:[],closed:false,async record(event){if(event.event===failEvent) throw new Error('Mock audit disk failure');this.events.push(structuredClone(event));},async close(){this.closed=true;}};
}
function fakeClient(options={}) {
  let rows=structuredClone(options.rows??initialRows()),before;
  const currentSchema=structuredClone(options.schema??schema),currentTarget=structuredClone(options.target??target);
  return {calls:[],connected:false,ended:false,
    rows:()=>structuredClone(rows),
    async connect(){this.connected=true;},async end(){this.ended=true;if(options.failClose)throw new Error('Mock close failure');},
    async query(sql,params=[]) {
      this.calls.push({sql,params:structuredClone(params)});
      if(options.failSql && sql.includes(options.failSql)) throw Object.assign(new Error('Mock query failure'),{code:'MOCK_DB_ERROR'});
      if(sql.startsWith('BEGIN')){before=structuredClone(rows);return {rows:[]};}
      if(sql==='ROLLBACK'){rows=before;return {rows:[]};}
      if(sql==='COMMIT')return {rows:[]};
      const name=/address-cleanup:(\w+)/.exec(sql)?.[1];
      if(name==='target')return {rows:[currentTarget]};
      if(Object.hasOwn(currentSchema,name))return {rows:structuredClone(currentSchema[name])};
      if(name==='rows')return {rows:structuredClone(rows.filter(row=>!params.length||params[0].includes(row.user_id))).sort((a,b)=>a.id.localeCompare(b.id))};
      if(name==='delete') {
        const removed=rows.filter(row=>row.user_id===params[0]&&params[1].includes(row.id)&&row.identity===params[2]);
        rows=rows.filter(row=>!removed.includes(row));return {rows:options.badDelete?[]:structuredClone(removed)};
      }
      if(name==='retain') {
        const row=rows.find(row=>row.id===params[2]&&row.user_id===params[3]);if(!row)return {rows:[]};
        if(row.label!==params[0]||row.is_default!==params[1])row.updated_at='2026-10-16 12:00:00+00';
        row.label=params[0];row.is_default=params[1];row.canonical_key=row.identity;
        if(options.tamperKeep)row.line1='Unexpected changed street';
        return {rows:[structuredClone(row)]};
      }
      return {rows:[]};
    },
  };
}
async function applyFixture({client=fakeClient(),plan=planFor(),authorization=approvalFor(plan),audit=fakeAudit(),clock=()=>NOW}={}) {
  const result=await applyCleanup({client,plan,authorization,confirmHash:plan.plan_sha256,confirmCount:1,audit,clock});
  return {result,client,audit};
}
const writeCalls=client=>client.calls.filter(call=>/address-cleanup:(delete|retain)/.test(call.sql));

test('default CLI mode is read-only and rejects destructive options without --apply',()=>{
  assert.deepEqual(parseCleanupArguments(['--out','new-plan.json']),{mode:'dry-run',out:'new-plan.json'});
  assert.throws(()=>parseCleanupArguments(['--out','new-plan.json','--authorization','approval.json']),code('READ_ONLY_DEFAULT'));
  assert.throws(()=>parseCleanupArguments(['--apply']),code('APPLY_FLAGS_REQUIRED'));
  assert.throws(()=>parseCleanupArguments(['--apply','--dry-run']),code('INVALID_ARGUMENTS'));
  assert.throws(()=>parseCleanupArguments(['--out','one','--out','two']),code('INVALID_ARGUMENTS'));
  assert.throws(()=>parseCleanupArguments(['--force']),code('INVALID_ARGUMENTS'));
});
test('dry-run inspects metadata in a read-only snapshot, reports exact proposed changes and never writes',async()=>{
  const client=fakeClient(),plan=await previewCleanup(client,NOW);
  assert.match(client.calls[0].sql,/REPEATABLE READ READ ONLY/);
  assert.equal(writeCalls(client).length,0);assert.deepEqual(client.rows(),initialRows());
  assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].recommended_keep_id,A);
  assert.equal(plan.groups[0].proposed_after.label,'Home');assert.equal(plan.groups[0].proposed_after.is_default,true);
  assert.deepEqual(plan.groups[0].duplicate_ids,[B]);assert.equal(plan.counts.proposed_deletions,1);
  assert.equal(plan.groups[0].members[0].created_at,'2026-07-01 12:00:00.000001+00');
});
test('plans and scope hashes are stable under input reordering',()=>{
  assert.deepEqual(planFor([...initialRows()].reverse()),planFor());
});
test('duplicate groups preserve default preference and flag conflicting valid labels',()=>{
  const rows=initialRows();rows[0].label='Work';const plan=planFor(rows);
  assert.equal(plan.groups[0].recommended_keep_id,A);assert.equal(plan.groups[0].blocked,true);
  assert.deepEqual(plan.groups[0].labels,['Work','Home']);
  assert.throws(()=>validateCleanupAuthorization(authorizationOptions(plan)),code('UNSAFE_SELECTION'));
});
for(const [name,change] of [
  ['incoming foreign key',state=>state.references.push({name:'saved_address_ref',referencing_table:'future_table',definition:'FOREIGN KEY (address_id) REFERENCES customer_addresses(id)'})],
  ['unknown metadata column',state=>state.columns.push({name:'delivery_instructions'})],
  ['disabled guard trigger',state=>state.triggers[0].enabled='D'],
  ['extra user trigger',state=>state.triggers.push({name:'external_mutation'})],
  ['missing unique index',state=>state.indexes=[]],
  ['invalid unique index',state=>state.indexes[0].valid=false],
  ['row-level security',state=>state.table[0].row_security=true],
  ['partitioned table',state=>state.table[0].kind='p'],
  ['database rewrite rule',state=>state.rules.push({name:'custom_rule'})],
  ['changed identity volatility',state=>state.identity_function[0].volatility='v'],
  ['privileged identity function',state=>state.identity_function[0].security_definer=true],
])test(`apply is blocked by ${name}, even with an approval file`,async()=>{
  const altered=structuredClone(schema);change(altered);const plan=planFor(initialRows(),{schema:altered}),client=fakeClient({schema:altered});
  await assert.rejects(applyFixture({plan,client}),code('SCHEMA_BLOCKED'));
  assert.equal(client.calls.length,0);
});
for(const [name,change,expected] of [
  ['missing authorization',()=>null,'MISSING_AUTHORIZATION'],
  ['wrong plan checksum',approval=>({...approval,plan_sha256:'0'.repeat(64)}),'MISSING_AUTHORIZATION'],
  ['missing explicit authorization text',approval=>({...approval,authorization:'approved'}),'MISSING_AUTHORIZATION'],
  ['blank approver',approval=>({...approval,approved_by:' '}),'MISSING_AUTHORIZATION'],
  ['wrong target',approval=>({...approval,target:{...target,database:'other'}}),'MISSING_AUTHORIZATION'],
  ['expired authorization',approval=>({...approval,expires_at:'2026-10-16T11:59:30Z'}),'EXPIRED_AUTHORIZATION'],
  ['future approval',approval=>({...approval,approved_at:'2026-10-16T12:01:00Z'}),'EXPIRED_AUTHORIZATION'],
  ['excess authorization lifetime',approval=>({...approval,expires_at:'2026-10-18T13:00:00Z'}),'EXPIRED_AUTHORIZATION'],
  ['unrelated deletion ID',approval=>({...approval,groups:[{keep_id:A,delete_ids:[C]}]}),'UNSAFE_SELECTION'],
  ['retained address included for deletion',approval=>({...approval,groups:[{keep_id:A,delete_ids:[A,B]}]}),'UNSAFE_SELECTION'],
  ['repeated group',approval=>({...approval,groups:[...approval.groups,...approval.groups]}),'REPEATED_ID'],
  ['wrong deletion count',approval=>({...approval,delete_count:2}),'COUNT_MISMATCH'],
])test(`authorization rejects ${name} before any database query`,async()=>{
  const plan=planFor(),client=fakeClient();await assert.rejects(applyFixture({plan,client,authorization:change(approvalFor(plan))}),code(expected));
  assert.equal(client.calls.length,0);
});
test('tampered plan or mismatched typed confirmation cannot be applied',()=>{
  const plan=planFor(),altered=structuredClone(plan);altered.groups[0].recommended_keep_id=C;
  assert.throws(()=>validateCleanupAuthorization({...authorizationOptions(altered),confirmHash:plan.plan_sha256}),code('PLAN_HASH_MISMATCH'));
  assert.throws(()=>validateCleanupAuthorization({...authorizationOptions(plan),confirmHash:'0'.repeat(64)}),code('PLAN_HASH_MISMATCH'));
  assert.throws(()=>validateCleanupAuthorization({...authorizationOptions(plan),confirmCount:2}),code('COUNT_MISMATCH'));
});
test('authorized mock transaction retains canonical ID, default, label and timestamps while preserving other addresses/customers',async()=>{
  const {client,audit,result}=await applyFixture();
  assert.equal(result.deleted_count,1);assert.deepEqual(result.retained_ids,[A]);
  const rows=client.rows(),keeper=rows.find(row=>row.id===A);
  assert.equal(keeper.label,'Home');assert.equal(keeper.is_default,true);assert.equal(keeper.created_at,initialRows()[0].created_at);
  for(const key of ['line1','city','postal_code','user_id'])assert.equal(keeper[key],initialRows()[0][key]);
  assert.deepEqual(rows.filter(row=>[C,D].includes(row.id)),initialRows().filter(row=>[C,D].includes(row.id)));
  assert.equal(rows.some(row=>row.id===B),false);
  assert.equal(audit.events[0].event,'prepared');assert.equal(audit.events.at(-1).event,'committed');
  const lock=client.calls.findIndex(call=>call.sql.startsWith('LOCK TABLE'));
  assert.ok(lock>client.calls.findIndex(call=>call.sql.startsWith('SELECT pg_advisory_xact_lock')));
  assert.ok(client.calls.findIndex(call=>call.sql.includes('address-cleanup:delete'))>lock);
  assert.ok(client.calls.some(call=>call.sql.includes("lock_timeout='5s'")));
  assert.ok(client.calls.every(call=>!/(DELETE FROM|UPDATE)\s+(orders|users|customer_wallets|customer_wings_stamp_ledger)/i.test(call.sql)));
});
for(const [name,options,expected] of [
  ['changed timestamp',{rows:initialRows().map(row=>row.id===B?{...row,updated_at:'changed'}:row)},'STALE_PLAN'],
  ['new address in affected account',{rows:[...initialRows(),address('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',{identity:'new',line1:'New destination'})]},'STALE_PLAN'],
  ['changed target',{target:{...target,database:'other'}},'TARGET_MISMATCH'],
  ['new foreign key',{schema:{...schema,references:[{name:'new_fk'}]}},'SCHEMA_CHANGED'],
  ['unexpected delete count',{badDelete:true},'DELETE_MISMATCH'],
  ['unexpected trigger mutation',{tamperKeep:true},'METADATA_MISMATCH'],
])test(`transaction rolls back on ${name}`,async()=>{
  const client=fakeClient(options),before=client.rows(),audit=fakeAudit();
  await assert.rejects(applyFixture({client,audit}),code(expected));
  assert.deepEqual(client.rows(),before);assert.ok(client.calls.some(call=>call.sql==='ROLLBACK'));
  assert.equal(client.calls.some(call=>call.sql==='COMMIT'),false);
});
test('a different connected target is rejected before any advisory or table lock',async()=>{
  const client=fakeClient({target:{...target,server_address:'10.0.0.9'}});
  await assert.rejects(applyFixture({client}),code('TARGET_MISMATCH'));
  assert.equal(client.calls.some(call=>/pg_advisory_xact_lock|LOCK TABLE/.test(call.sql)),false);
  assert.ok(client.calls.some(call=>call.sql==='ROLLBACK'));
});
test('lock timeouts abort before mutation and are never retried',async()=>{
  const client=fakeClient({failSql:'LOCK TABLE'});
  await assert.rejects(applyFixture({client}));assert.equal(writeCalls(client).length,0);
  assert.equal(client.calls.filter(call=>call.sql.startsWith('LOCK TABLE')).length,1);
  assert.ok(client.calls.some(call=>call.sql==='ROLLBACK'));
});
test('expired authorization after preflight rolls back before writing',async()=>{
  let call=0;const client=fakeClient();
  await assert.rejects(applyFixture({client,clock:()=>++call===1?NOW:new Date('2026-10-16T14:00:00Z')}),code('EXPIRED_AUTHORIZATION'));
  assert.equal(writeCalls(client).length,0);
});
test('audit must be writable before transaction start and before mutations',async()=>{
  const client=fakeClient();await assert.rejects(applyFixture({client,audit:fakeAudit('prepared')}));assert.equal(client.calls.length,0);
  const next=fakeClient();await assert.rejects(applyFixture({client:next,audit:fakeAudit('group_before')}));
  assert.equal(writeCalls(next).length,0);assert.ok(next.calls.some(call=>call.sql==='ROLLBACK'));
});
test('audit failure after a staged deletion rolls the transaction back',async()=>{
  const client=fakeClient();await assert.rejects(applyFixture({client,audit:fakeAudit('group_after')}));
  assert.deepEqual(client.rows(),initialRows());assert.ok(client.calls.some(call=>call.sql==='ROLLBACK'));
});
test('failed commit acknowledgement is explicitly unknown and is never retried or described as rollback',async()=>{
  const client=fakeClient({failSql:'COMMIT'}),audit=fakeAudit();
  await assert.rejects(applyFixture({client,audit}),code('COMMIT_OUTCOME_UNKNOWN'));
  assert.equal(client.calls.filter(call=>call.sql==='COMMIT').length,1);
  assert.equal(client.calls.some(call=>call.sql==='ROLLBACK'),false);
  assert.equal(audit.events.at(-1).event,'commit_outcome_unknown');
});
test('final audit failure after acknowledged commit reports committed state, never retries',async()=>{
  const client=fakeClient();await assert.rejects(applyFixture({client,audit:fakeAudit('committed')}),code('AUDIT_FINALIZATION_FAILED'));
  assert.equal(client.calls.filter(call=>call.sql==='COMMIT').length,1);assert.equal(client.calls.some(call=>call.sql==='ROLLBACK'),false);
});
test('exclusive, fsynced audit entries contain a verifiable sequence/hash chain',async()=>{
  const lines=[],opened=[];let synced=0,closed=false;
  const audit=await createCleanupAudit('new-audit.jsonl',{runId:'fixture',clock:()=>NOW,openFile:async(...args)=>{
    opened.push(args);return {async writeFile(line){lines.push(JSON.parse(line));},async sync(){synced++;},async close(){closed=true;}};
  }});
  await audit.record({event:'prepared',sequence:999});await audit.record({event:'committed'});await audit.close();
  assert.deepEqual(opened,[['new-audit.jsonl','wx',0o600]]);assert.equal(synced,2);assert.equal(closed,true);
  assert.equal(lines[0].sequence,1);assert.equal(lines[1].previous_sha256,lines[0].entry_sha256);
  for(const {entry_sha256,...entry} of lines)assert.equal(digest(entry),entry_sha256);
  await assert.rejects(audit.record({event:'late'}));
});
test('audit writer remains failed after a disk sync error',async()=>{
  let writes=0;const audit=await createCleanupAudit('new-audit',{openFile:async()=>({async writeFile(){writes++;},async sync(){throw new Error('disk failure');},async close(){}})});
  await assert.rejects(audit.record({event:'prepared'}));await assert.rejects(audit.record({event:'next'}));assert.equal(writes,1);await audit.close();
});
test('new dry-run files use exclusive creation and are synced before close',async()=>{
  const events=[];await writeNewCleanupReport('plan',{safe:true},{openFile:async(...args)=>{
    events.push(args);return {async writeFile(value){events.push(JSON.parse(value));},async sync(){events.push('sync');},async close(){events.push('close');}};
  }});
  assert.deepEqual(events,[['plan','wx',0o600],{safe:true},'sync','close']);
});
test('CLI dry run enables server read-only mode, returns report and never logs credentials',async()=>{
  const client=fakeClient(),logs=[],outputs=[],configs=[];
  await runCleanupCli({args:['--out','plan.json'],env:{ADDRESS_RECONCILIATION_DATABASE_URL:'postgresql://tester:secret@example.invalid/fixture'},
    createClient:config=>{configs.push(config);return client;},writeReport:async(...args)=>outputs.push(args),log:value=>logs.push(value),clock:()=>NOW});
  assert.equal(configs[0].options,'-c default_transaction_read_only=on');assert.equal(client.ended,true);
  assert.equal(client.calls[0].sql,'SET SESSION default_transaction_read_only=on');assert.match(client.calls[1].sql,/^BEGIN .*READ ONLY/);
  assert.equal(writeCalls(client).length,0);assert.equal(outputs[0][1].mode,'DRY_RUN');assert.ok(logs.every(line=>!line.includes('secret')));
});
test('CLI apply preflight rejects invalid authorization before connecting or opening an audit',async()=>{
  let connections=0,audits=0;const plan=planFor();
  await assert.rejects(runCleanupCli({args:['--apply','--plan','plan','--authorization','approval','--audit','newaudit',
    '--confirm-plan-sha256',plan.plan_sha256,'--confirm-delete-count','1'],env:{ADDRESS_RECONCILIATION_DATABASE_URL:'postgresql://tester:secret@example.invalid/fixture'},
    readReviewFile:async path=>path==='plan'?plan:null,createClient:()=>{connections++;},auditFactory:async()=>{audits++;},clock:()=>NOW}),code('MISSING_AUTHORIZATION'));
  assert.equal(connections,0);assert.equal(audits,0);
});
test('CLI requires an explicit database URL and sanitizes unexpected errors',async()=>{
  await assert.rejects(runCleanupCli({args:['--out','plan'],env:{DATABASE_URL:'postgresql://secret@production/never-used'}}),code('DATABASE_URL_REQUIRED'));
  assert.ok(!cleanupErrorMessage(new Error('postgresql://username:secret@host/db')).includes('secret'));
});
test('apply requires an audit writer even with valid authorization',async()=>{
  const plan=planFor(),client=fakeClient();
  await assert.rejects(applyCleanup({...authorizationOptions(plan),client,clock:()=>NOW}),code('AUDIT_REQUIRED'));
  assert.equal(client.calls.length,0);
});
test('a failed precommit audit entry prevents COMMIT and rolls back every staged change',async()=>{
  const client=fakeClient();await assert.rejects(applyFixture({client,audit:fakeAudit('commit_requested')}));
  assert.deepEqual(client.rows(),initialRows());assert.equal(client.calls.some(call=>call.sql==='COMMIT'),false);
});
test('unconfirmed rollback is reported distinctly without retry',async()=>{
  const rows=initialRows();rows[0].updated_at='stale';const client=fakeClient({rows,failSql:'ROLLBACK'});
  await assert.rejects(applyFixture({client}),code('ROLLBACK_UNCONFIRMED'));
  assert.equal(client.calls.filter(call=>call.sql==='ROLLBACK').length,1);
});
test('changes to an unrelated customer do not authorize changing that customer',async()=>{
  const rows=initialRows();rows[3].line1='Unrelated customer change';
  const client=fakeClient({rows});await applyFixture({client});
  assert.deepEqual(client.rows().find(row=>row.id===D),rows[3]);
});
test('approval can select a complete safe group while leaving an unapproved conflicting group untouched',async()=>{
  const rows=[...initialRows(),address('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',{line1:'20 King',identity:'other-group',label:'Work'}),
    address('ffffffff-ffff-4fff-8fff-ffffffffffff',{line1:'20 King',identity:'other-group',label:'Home'})];
  const plan=planFor(rows),client=fakeClient({rows});await applyFixture({plan,client});
  assert.equal(client.rows().filter(row=>row.identity==='other-group').length,2);
});
test('canonical row created_at and updated_at remain exact when display metadata needs no change',async()=>{
  const rows=initialRows();rows[0].label='Home';const plan=planFor(rows),client=fakeClient({rows});
  await applyFixture({plan,client});const kept=client.rows().find(row=>row.id===A);
  assert.equal(kept.created_at,rows[0].created_at);assert.equal(kept.updated_at,rows[0].updated_at);
});
test('CLI preserves commit uncertainty even if connection close also fails',async()=>{
  const plan=planFor(),audit=fakeAudit(),client=fakeClient({failSql:'COMMIT',failClose:true});
  await assert.rejects(runCleanupCli({args:['--apply','--plan','plan','--authorization','approval','--audit','newaudit',
    '--confirm-plan-sha256',plan.plan_sha256,'--confirm-delete-count','1'],env:{ADDRESS_RECONCILIATION_DATABASE_URL:'postgresql://tester:secret@example.invalid/fixture'},
    readReviewFile:async path=>path==='plan'?plan:approvalFor(plan),createClient:()=>client,auditFactory:async()=>audit,clock:()=>NOW,log:()=>{}}),code('COMMIT_OUTCOME_UNKNOWN'));
  assert.equal(client.ended,true);assert.equal(audit.closed,true);
});
test('CLI reports committed state clearly if only resource close fails',async()=>{
  const plan=planFor(),audit=fakeAudit(),client=fakeClient({failClose:true});
  await assert.rejects(runCleanupCli({args:['--apply','--plan','plan','--authorization','approval','--audit','newaudit',
    '--confirm-plan-sha256',plan.plan_sha256,'--confirm-delete-count','1'],env:{ADDRESS_RECONCILIATION_DATABASE_URL:'postgresql://tester:secret@example.invalid/fixture'},
    readReviewFile:async path=>path==='plan'?plan:approvalFor(plan),createClient:()=>client,auditFactory:async()=>audit,clock:()=>NOW,log:()=>{}}),code('POST_COMMIT_CLOSE_FAILED'));
  assert.equal(audit.events.at(-1).event,'committed');assert.equal(audit.closed,true);
});

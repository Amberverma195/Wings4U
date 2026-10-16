import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildAddressReconciliationPlan, addressPreviewQuery } from '../prisma/address-reconciliation.mjs';

const migration = await readFile(new URL('../prisma/migrations/20261016120000_customer_address_identity/migration.sql', import.meta.url), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const baseSchema = `CREATE TABLE customer_addresses (
  id UUID PRIMARY KEY, user_id UUID NOT NULL, line1 TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT NOT NULL,
  label TEXT, is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);`;
const insert = (db, { user = USER, street = '629 B Huron St unit 111', city = 'London', postal = 'N5Y4J7', id = randomUUID(), key } = {}) =>
  db.query('INSERT INTO customer_addresses (id,user_id,line1,city,postal_code,canonical_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id,user,street,city,postal,key ?? null]);
async function database() { const db = new PGlite(); await db.exec(baseSchema); await db.exec(migration); return db; }
const uniqueError = error => error.code === '23505';

test('migration preserves legacy duplicate IDs, labels, defaults and timestamps', async () => {
  const db = new PGlite();
  try {
    await db.exec(baseSchema);
    for (const postal of ['N5Y4J7','N5Y 4J7']) await db.query("INSERT INTO customer_addresses (id,user_id,line1,city,postal_code,label,is_default) VALUES ($1,$2,'629 B Huron St unit 111','London',$3,'Home',true)", [randomUUID(), USER, postal]);
    const before = (await db.query('SELECT * FROM customer_addresses ORDER BY id')).rows;
    const report = buildAddressReconciliationPlan((await db.query(addressPreviewQuery)).rows);
    assert.equal(report.length,1);
    assert.equal(report[0].members.length,2);
    assert.equal(report[0].requires_label_review,false);
    await db.exec(migration);
    const after = (await db.query('SELECT * FROM customer_addresses ORDER BY id')).rows;
    assert.deepEqual(after.map(({canonical_key,...row}) => row), before);
    assert.ok(after.every(row => row.canonical_key === null));
    await assert.rejects(insert(db), uniqueError);
    await db.query("UPDATE customer_addresses SET label = 'Work' WHERE id = $1", [after[0].id]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customer_addresses')).rows[0].n, 2);
  } finally { await db.close(); }
});

test('read-only reconciliation recommendations preserve defaults and identify conflicting labels', () => {
  const rows = [
    {id:'b',user_id:USER,identity:'same-unit',is_default:false,label:'Work',created_at:'2026-01-01'},
    {id:'a',user_id:USER,identity:'same-unit',is_default:true,label:null,created_at:'2026-02-01'},
    {id:'c',user_id:USER,identity:'same-unit',is_default:false,label:'Home',created_at:'2026-03-01'},
    {id:'d',user_id:USER,identity:'other-unit',is_default:false,label:'Other'},
    {id:'e',user_id:OTHER,identity:'same-unit',is_default:false,label:'Home'},
  ];
  const report=buildAddressReconciliationPlan(rows);
  assert.equal(report.length,1);
  assert.equal(report[0].recommended_keep_id,'a');
  assert.equal(report[0].requires_label_review,true);
  assert.deepEqual(buildAddressReconciliationPlan([...rows].reverse()),report);
});
test('postal formatting, street/city case and extra whitespace have one identity', async () => {
  const db = await database();
  try {
    await insert(db);
    for (const variant of [{postal:'n5y 4j7'}, {postal:' N5Y   4J7 '}, {street:' 629   b HURON St unit 111 ',city:' london '}]) await assert.rejects(insert(db,variant),uniqueError);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customer_addresses')).rows[0].n,1);
  } finally { await db.close(); }
});
test('units, streets, cities and customers remain distinct', async () => {
  const db = await database();
  try {
    await insert(db);
    for (const variant of [{street:'629 B Huron St unit 112'},{street:'630 B Huron St unit 111'},{city:'Toronto'},{user:OTHER}]) await insert(db,variant);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM customer_addresses')).rows[0].n,5);
  } finally { await db.close(); }
});
test('a rejected duplicate edit rolls back default changes and preserves both addresses', async () => {
  const db = await database();
  try {
    const first=(await insert(db)).rows[0], second=(await insert(db,{street:'20 King Street'})).rows[0];
    await db.query('UPDATE customer_addresses SET is_default=true WHERE id=$1',[first.id]);
    await assert.rejects(db.transaction(async tx => {
      await tx.query('UPDATE customer_addresses SET is_default=false WHERE id=$1',[first.id]);
      await tx.query('UPDATE customer_addresses SET line1=$1,is_default=true WHERE id=$2',[first.line1,second.id]);
    }),uniqueError);
    assert.equal((await db.query('SELECT is_default FROM customer_addresses WHERE id=$1',[first.id])).rows[0].is_default,true);
    assert.equal((await db.query('SELECT line1 FROM customer_addresses WHERE id=$1',[second.id])).rows[0].line1,'20 King Street');
  } finally { await db.close(); }
});
test('direct writes cannot bypass uniqueness using NULL or forged keys', async () => {
  const db = await database();
  try {
    const row=(await insert(db,{key:'fake'})).rows[0]; assert.notEqual(row.canonical_key,'fake');
    await assert.rejects(insert(db,{key:'another-fake'}),uniqueError);
    await db.query('UPDATE customer_addresses SET canonical_key=NULL WHERE id=$1',[row.id]);
    assert.equal((await db.query('SELECT canonical_key FROM customer_addresses WHERE id=$1',[row.id])).rows[0].canonical_key,row.canonical_key);
  } finally { await db.close(); }
});
test('simultaneously submitted creates leave one record', async () => {
  const db = await database();
  try {
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>insert(db,{postal:i%2?'N5Y4J7':'n5y 4j7'})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.ok(results.filter(result=>result.status==='rejected').every(result=>uniqueError(result.reason)));
  } finally { await db.close(); }
});
test('simultaneously submitted edits to one identity allow one winner', async () => {
  const db = await database();
  try {
    const rows=await Promise.all([insert(db,{street:'10 King Street'}),insert(db,{street:'20 King Street'})]);
    const results=await Promise.allSettled(rows.map(result=>db.query("UPDATE customer_addresses SET line1='30 King Street' WHERE id=$1",[result.rows[0].id])));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  } finally { await db.close(); }
});
test('ownership cannot change; deleting then re-saving works', async () => {
  const db = await database();
  try {
    const row=(await insert(db)).rows[0];
    await assert.rejects(db.query('UPDATE customer_addresses SET user_id=$1 WHERE id=$2',[OTHER,row.id]),error=>error.code==='23514');
    await db.query('DELETE FROM customer_addresses WHERE id=$1',[row.id]); await insert(db);
  } finally { await db.close(); }
});

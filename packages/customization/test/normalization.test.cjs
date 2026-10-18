const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIngredientText: normalize, resolveIngredientMapping: resolve } = require('../dist');

// Pure string fixtures: these names do not describe restaurant inventory.
for (const [input, expected] of [
  ['A & B', 'a and b'], ['TEST & TEST', 'test and test'], ['TÉST', 'test'],
  ['TEST-ITEM', 'test item'], ['  TEST    ITEM  ', 'test item'],
  ['test item', 'test item'], ['TEST ITEM', 'test item'], ['TÉST...ÏTÈM!?', 'test item'],
]) test(`canonical string normalization: ${input}`, () => {
  assert.equal(normalize(input), expected);
  assert.equal(normalize(expected), expected);
});

test('saved ampersand mappings resolve without rewriting the stored value', () => {
  for (const match of ['a b', 'a and b']) assert.equal(resolve(match, ['A & B']), 'a and b');
  assert.equal(resolve('test item', ['TÉST-ITEM']), 'test item');
  assert.equal(resolve('test', ['TEST']), 'test');
});

test('legacy collisions, missing mappings and reserved approvals fail closed', () => {
  assert.equal(resolve('a b', ['A & B', 'A B']), null);
  assert.equal(resolve('a b c', ['A & B C', 'A B & C']), null);
  for (const match of [null, '', '__unconfigured__', '__always__', 'unknown']) {
    assert.equal(resolve(match, ['A & B']), null);
  }
  assert.equal(resolve('a b', []), null);
  // Never turn a canonical "and" into a permissive legacy alias.
  assert.equal(resolve('a b', ['A and B']), null);
});

test('legacy and canonical string aliases resolve to one identity without mutating inputs', () => {
  const names = ['A & B'];
  const before = JSON.stringify(names);
  assert.equal(resolve('a b', names), resolve('a and b', names));
  assert.equal(JSON.stringify(names), before);
});

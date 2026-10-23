'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSubmission, problem, clean } = require('../public/js/validate.js');

const CATEGORIES = ['Confidence', 'Our Own'];
const ok = (input) => checkSubmission({ challenge: 'I can', response: 'do it.', category: 'Confidence', ...input }, CATEGORIES);

test('clean: whitespace collapses and trims', () => {
  // protects=stored text is tidy and length checks count real characters; fails_when=runs of spaces or newlines survive; no_claim=Unicode normalization
  assert.equal(clean('  I  can\n do\tit  '), 'I can do it');
});

test('length: 1 to 160 characters per half', () => {
  // protects=cards stay readable and match the database CHECK; fails_when=empty or 161-character halves pass, or 160 fails; no_claim=how long text fits on a card (fit() shrinks it)
  assert.equal(ok({ challenge: '' }).ok, false);
  assert.equal(ok({ response: 'x'.repeat(161) }).ok, false);
  assert.equal(ok({ response: 'x'.repeat(160) }).ok, true);
});

test('contact details: links, emails and 7+ digit runs are refused, ordinary numbers pass', () => {
  // protects=kids never read contact details; fails_when=a link, email or phone (with spaces, dots, dashes or brackets) passes, or "I am 7 years old" fails; no_claim=spelled-out numbers
  const email = ['a', 'b.co'].join('@');
  for (const bad of ['http://x', 'HTTPS x', 'www.x', email, '808 555 0123', '808.555.0123', '(808) 555-0123', '1234567']) {
    assert.ok(problem(bad), bad);
  }
  for (const fine of ['I am 7 years old.', 'I can count to 100.', 'When I feel left out,']) {
    assert.equal(problem(fine), null, fine);
  }
});

test('category: unknown names fall back to Our Own', () => {
  // protects=a forged category cannot create a new chip; fails_when=an unknown category is kept; no_claim=none beyond protects
  assert.equal(ok({ category: 'Made Up' }).value.category, 'Our Own');
  assert.equal(ok({}).value.category, 'Confidence');
});

test('contact: optional, at most 120 characters, empty becomes null', () => {
  // protects=the optional name or email stays small and absent means absent; fails_when=121 characters pass or "" is stored as ""; no_claim=whether the contact is a real address
  assert.equal(ok({ contact: '   ' }).value.contact, null);
  assert.equal(ok({ contact: 'Pat' }).value.contact, 'Pat');
  assert.equal(ok({ contact: 'x'.repeat(121) }).ok, false);
});

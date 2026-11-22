/**
 * test/search_keywords.test.js
 *
 * Validates the curated keyword-search crawl targets. Every target must have a
 * non-empty keyword and a category_id that actually exists in categories.json,
 * because saveDepartmentBatch writes products.category_id from that value.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const searchFile = path.join(root, 'search_keywords.json');
const categoriesFile = path.join(root, 'categories.json');

describe('search_keywords.json', () => {
  const categories = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
  const validIds = new Set(categories.map(c => c.id));
  const parsed = JSON.parse(fs.readFileSync(searchFile, 'utf-8'));
  const searches = Array.isArray(parsed) ? parsed : (parsed.searches || []);

  it('is a non-empty list of search targets', () => {
    assert.ok(Array.isArray(searches), 'searches must be an array');
    assert.ok(searches.length > 0, 'searches must not be empty');
  });

  it('every target has a non-empty keyword', () => {
    for (const entry of searches) {
      assert.strictEqual(typeof entry, 'object', 'each target must be an object');
      assert.ok(typeof entry.keyword === 'string' && entry.keyword.trim().length > 0,
        `invalid keyword in entry: ${JSON.stringify(entry)}`);
    }
  });

  it('every target maps to a real category_id from categories.json', () => {
    for (const entry of searches) {
      assert.ok(entry.category_id, `missing category_id for keyword "${entry.keyword}"`);
      assert.ok(validIds.has(entry.category_id),
        `unknown category_id "${entry.category_id}" for keyword "${entry.keyword}"`);
    }
  });

  it('has no duplicate keyword+category pairs', () => {
    const seen = new Set();
    for (const entry of searches) {
      const key = `${entry.keyword.toLowerCase()}::${entry.category_id}`;
      assert.ok(!seen.has(key), `duplicate target: ${key}`);
      seen.add(key);
    }
  });

  it('covers Pampers Premium (the reported catalog gap)', () => {
    const hasPampers = searches.some(
      e => /pampers/i.test(e.keyword) && e.category_id === 'baby-care'
    );
    assert.ok(hasPampers, 'search_keywords.json must include a Pampers -> baby-care target');
  });
});

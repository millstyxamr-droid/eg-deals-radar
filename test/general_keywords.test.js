/**
 * test/general_keywords.test.js
 *
 * Validates general_keywords.json targets: every target must have a non-empty
 * keyword, map to a real category_id in categories.json, and have no duplicates.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const generalFile = path.join(root, 'general_keywords.json');
const categoriesFile = path.join(root, 'categories.json');

describe('general_keywords.json', () => {
  const categories = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
  const validIds = new Set(categories.map(c => c.id));
  const parsed = JSON.parse(fs.readFileSync(generalFile, 'utf-8'));
  const searches = Array.isArray(parsed) ? parsed : (parsed.searches || []);

  it('configures general store mode with multi-page crawling', () => {
    assert.strictEqual(parsed.store, 'general');
    assert.ok(typeof parsed.pages === 'number' && parsed.pages >= 1);
    assert.ok(searches.length >= 40, 'should cover broad Amazon.eg categories');
  });

  it('every target has a non-empty keyword and valid category_id', () => {
    const seen = new Set();
    for (const entry of searches) {
      assert.ok(typeof entry.keyword === 'string' && entry.keyword.trim().length > 0);
      assert.ok(entry.category_id && validIds.has(entry.category_id),
        `unknown category_id "${entry.category_id}" for keyword "${entry.keyword}"`);
      const key = `${entry.keyword.toLowerCase()}::${entry.category_id}`;
      assert.ok(!seen.has(key), `duplicate target: ${key}`);
      seen.add(key);
    }
  });
});

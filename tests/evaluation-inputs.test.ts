import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
// Freeze evaluation inputs from main@9080434, independent of engine changes.
// Updating these pins is a deliberate baseline version change.
test.each([
  ['splits.json', 'efec54404424e8680285790037579c3c4bb6dea2'],
  ['pairs.jsonl', 'd6a0fb159c8bcf0bcd0057ea961108156660173d'],
  ['index_train.json', '9c63a7afadcf9f244041fdf2f420effd2a0db644'],
])('fixed evaluation input %s', (file, hash) => {
  const bytes = readFileSync(new URL('../translator/data/' + file, import.meta.url));
  const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  expect(actual).toBe(hash);
});

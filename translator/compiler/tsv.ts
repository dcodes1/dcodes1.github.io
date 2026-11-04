/* Strict TSV reader for bukhori.tsv: fails loudly on any shape change. */
import { readFileSync } from 'node:fs';
import type { EntryType, SourceRef } from './types.ts';

export const COLUMNS = [
  'page', 'lesson', 'entry_type', 'section', 'english', 'bukhori',
  'spoken_form', 'alt_forms', 'numeric_value', 'notes', 'flag',
] as const;
type Column = (typeof COLUMNS)[number];

const ENTRY_TYPES: readonly EntryType[] = ['vocab', 'example', 'phrase', 'exercise', 'paradigm', 'grammar', 'reading', 'proverb'];

export interface Row {
  row: number;                  // 1-based line number in the file (header = 1)
  page: number;
  lesson: string;
  entryType: EntryType;
  section: string;
  english: string;
  bukhori: string;
  spoken: string;
  alt: string;
  numeric: string;
  notes: string;
  review: boolean;
}

export function readTsv(path: string): { rows: Row[]; raw: Buffer } {
  const raw = readFileSync(path);
  const text = raw.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const header = (lines[0] ?? '').split('\t');
  if (header.join('\t') !== COLUMNS.join('\t')) {
    throw new Error(`Unexpected TSV header:\n  got      ${header.join(' | ')}\n  expected ${COLUMNS.join(' | ')}`);
  }
  const rows: Row[] = [];
  lines.slice(1).forEach((line, i) => {
    const lineNo = i + 2;
    const cells = line.split('\t');
    if (cells.length !== COLUMNS.length) throw new Error(`Row ${lineNo}: ${cells.length} fields, expected ${COLUMNS.length}`);
    const get = (c: Column) => (cells[COLUMNS.indexOf(c)] ?? '').trim();
    const entryType = get('entry_type') as EntryType;
    if (!ENTRY_TYPES.includes(entryType)) throw new Error(`Row ${lineNo}: unknown entry_type "${entryType}"`);
    const page = Number(get('page'));
    if (!Number.isInteger(page)) throw new Error(`Row ${lineNo}: non-numeric page "${get('page')}"`);
    const flag = get('flag');
    if (flag && flag !== 'REVIEW') throw new Error(`Row ${lineNo}: unknown flag "${flag}"`);
    rows.push({
      row: lineNo, page, lesson: get('lesson'), entryType, section: get('section'),
      english: get('english'), bukhori: get('bukhori'), spoken: get('spoken_form'),
      alt: get('alt_forms'), numeric: get('numeric_value'), notes: get('notes'), review: flag === 'REVIEW',
    });
  });
  return { rows, raw };
}

export function sourceRef(r: Row): SourceRef {
  return {
    row: r.row, page: r.page, lesson: r.lesson, section: r.section, entryType: r.entryType,
    ...(r.review ? { review: true as const } : {}),
    ...(r.notes ? { note: r.notes } : {}),
  };
}

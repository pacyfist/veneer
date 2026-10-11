import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';

/**
 * Records what an attack cost: the lines of attack code between the
 * `// attack:begin` and `// attack:end` markers in the calling spec (blank and
 * comment-only lines not counted) and the wall time it took. Shown as a test
 * annotation and printed, so the attack matrix in README.md can be checked
 * against a real run.
 */
export function recordCost(attack: string, milliseconds: number): void {
  const info = test.info();
  const source = readFileSync(info.file, 'utf8');
  const begin = source.indexOf('// attack:begin');
  const end = source.indexOf('// attack:end');
  if (begin < 0 || end < begin) throw new Error(`${info.file}: attack markers missing`);
  const lines = source
    .slice(begin, end)
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() && !/^\s*(\/\/|\/\*|\*)/.test(line)).length;

  const description = `${attack}: ${lines} lines of attack code, ${Math.round(milliseconds)} ms`;
  info.annotations.push({ type: 'attack cost', description });
  console.log(`[${info.project.name}] ${description}`);
}

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every protected text in the demo, read from the demo's own source so the
 * leak and adversary checks cannot drift from what the site actually protects.
 *
 * Three forms reach the forged font:
 * - `element`: `<p veneer>Text</p>`. Found by scanning component templates;
 *   `${CONST}` splices are resolved from the same file.
 * - `bound`: `[veneer]="expr"`, and `pipe`: `{{ expr | veneer }}`. The string
 *   behind `expr` lives in code, often in another component, so each binding
 *   site is mapped by hand in BINDINGS below. A new binding site in the demo
 *   that is not listed there throws, rather than going unchecked.
 *
 * Not collected, on purpose: strings the demo only ever shows as ciphertext
 * in the ordinary font (the hero's bot lens, trade-offs' SPOKEN, the
 * how-it-works word table) and the two-letter kerning sample `AV To`, which
 * is not content.
 */

const APP = 'projects/demo/src/app';

export type SpecimenForm = 'element' | 'bound' | 'pipe';

export interface Specimen {
  /** Short and stable enough for a test title. */
  readonly id: string;
  /** Where the text is defined, relative to projects/demo/src/app. */
  readonly file: string;
  readonly form: SpecimenForm;
  readonly text: string;
}

/**
 * Binding site (`file: expression`) -> the declarations holding the strings it
 * renders: `const NAME = '...'` or `name = signal('...')`.
 */
const BINDINGS: Record<string, readonly { file: string; name: string }[]> = {
  'sections/apply-tabs.ts: [veneer]="bound()"': [{ file: 'sections/apply-tabs.ts', name: 'bound' }],
  'sections/apply-tabs.ts: piped() | veneer': [{ file: 'sections/apply-tabs.ts', name: 'piped' }],
  // SpecimenCard renders IsolatedInstance's [text], which bench and breakage pass in.
  'ui/specimen-card.ts: [veneer]="text()"': [
    { file: 'sections/bench.ts', name: 'SAMPLE' },
    { file: 'sections/breakage.ts', name: 'SAMPLE' },
  ],
  // MirrorPanel renders TryIt's typed text, which starts out as this default.
  'ui/mirror-panel.ts: readable() | veneer': [{ file: 'sections/try-it.ts', name: 'text' }],
};

const read = (file: string) => readFileSync(join(APP, file), 'utf8');

function sourceFiles(dir = ''): string[] {
  return readdirSync(join(APP, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(rel);
    return rel.endsWith('.ts') && !rel.endsWith('.spec.ts') ? [rel] : [];
  });
}

/** The string literal assigned to `name`, directly or through `signal(...)`. */
function literal(file: string, name: string): string {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:signal(?:<[^>]*>)?\\(\\s*)?(['"])((?:\\\\.|(?!\\1).)*)\\1`,
  );
  const match = read(file).match(pattern);
  if (!match)
    throw new Error(`e2e/support/demo-specimens.ts: no string literal ${name} in ${file}`);
  return match[2].replace(/\\(.)/g, '$1');
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function idFor(file: string, form: SpecimenForm, text: string): string {
  const words = text.split(' ');
  const head = words.slice(0, 4).join(' ') + (words.length > 4 ? '…' : '');
  return `${file.replace(/^.*\//, '').replace(/\.ts$/, '')} ${form} "${head}"`;
}

function collect(): Specimen[] {
  const specimens: Specimen[] = [];
  const unmapped: string[] = [];
  const add = (file: string, form: SpecimenForm, text: string) => {
    if (!specimens.some((s) => s.text === text)) {
      specimens.push({ id: idFor(file, form, text), file, form, text });
    }
  };

  for (const file of sourceFiles()) {
    const source = read(file);
    // The @Component template, not a `template:` quoted inside a code sample.
    const template = source.match(/\n {2}template:\s*`((?:\\`|[^`])*)`/)?.[1];
    if (!template) continue;

    // <tag ... veneer ...>content</tag>, where `veneer` is a bare attribute.
    const opening = /<([a-z][\w-]*)((?:\s+[^\s>=]+(?:="[^"]*")?)*)\s*>/g;
    for (const m of template.matchAll(opening)) {
      const [tag, name, attributes] = m;
      if (!/(?:^|\s)veneer(?=\s|$)/.test(attributes)) continue;
      const start = m.index + tag.length;
      const content = template.slice(start, template.indexOf(`</${name}>`, start));
      const text = squash(
        content
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\$\{(\w+)\}/g, (_, name: string) => literal(file, name)),
      );
      // `<p veneer>{{ x }}</p>` is the documented trap; its string is the pipe specimen.
      if (text && !text.includes('{{')) add(file, 'element', text);
    }

    const sites = [
      ...[...template.matchAll(/\[veneer\]="([^"]+)"/g)].map((m) => ({
        form: 'bound' as const,
        site: `${file}: [veneer]="${m[1]}"`,
      })),
      ...[...template.matchAll(/\{\{\s*([^}|]+?)\s*\|\s*veneer\s*\}\}/g)].map((m) => ({
        form: 'pipe' as const,
        site: `${file}: ${m[1]} | veneer`,
      })),
    ];
    for (const { form, site } of sites) {
      const sources = BINDINGS[site];
      if (!sources) unmapped.push(site);
      for (const s of sources ?? []) add(s.file, form, literal(s.file, s.name));
    }
  }

  if (unmapped.length) {
    throw new Error(
      `New veneer binding sites in the demo; map them in BINDINGS in e2e/support/demo-specimens.ts:\n  ${unmapped.join('\n  ')}`,
    );
  }
  return specimens;
}

export const SPECIMENS: readonly Specimen[] = collect();

/** Just the protected strings, for findVeneerLeaks. */
export const ORIGINALS: readonly string[] = SPECIMENS.map((s) => s.text);

/** The hero paragraph, which every form of attack goes after first. */
export const HERO = SPECIMENS.find((s) => s.file === 'sections/hero.ts')!;

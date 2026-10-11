import { expect, test } from '@playwright/test';
import { findVeneerLeaks } from '../../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, ORIGINALS } from '../support/demo-specimens';
import { DEMO_HTML_LEAKS } from '../support/known-leaks';
import { fetchServedPage, visibleText } from '../support/served-html';
import { recordCost } from './cost';

/**
 * Adversary (a): a generic crawler. One HTTP GET, an HTML parser, no
 * JavaScript, no knowledge of veneer. This is what most bulk scrapers and
 * AI-training crawlers do.
 *
 * It reads the document text and every attribute value, then looks for each
 * protected specimen, whole or as any run of 4 consecutive words.
 */
test.describe('adversary (a): plain fetch, no JavaScript', () => {
  test('recovers no protected text except what the demo prints in the clear', async ({
    request,
  }) => {
    const started = performance.now();
    // attack:begin
    const { document } = await fetchServedPage(request);
    const attributes = [...document.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].map((a) => a.value),
    );
    const crawled = [document.title, visibleText(document), ...attributes].join('\n');
    // attack:end
    recordCost('plain fetch', performance.now() - started);

    const recovered = [...new Set(findVeneerLeaks(crawled, ORIGINALS).map((l) => l.original))];

    expect(recovered, 'the hero paragraph is readable to a plain crawler').not.toContain(HERO.text);
    // Anything beyond the demo's own clear-text copies is a library leak.
    expect(recovered.sort()).toEqual(Object.keys(DEMO_HTML_LEAKS).sort());
  });
});

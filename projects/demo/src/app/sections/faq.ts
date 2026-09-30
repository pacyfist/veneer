import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeading } from '../ui/section-heading';

interface Question {
  readonly q: string;
  readonly a: string;
}

/** Answers ground in the README; keep them in step with it. */
const QUESTIONS: readonly Question[] = [
  {
    q: 'Is this only for Angular?',
    a: 'Yes. veneer is an Angular library for Angular 21.2 and newer: the directive, pipe and provideVeneer() are Angular APIs, and it supports SSR and hydration. There is no React or Vue wrapper.',
  },
  {
    q: 'Does it stop AI scrapers completely?',
    a: "No. It stops the cheap, bulk kind: fetching HTML, reading innerText, pasting a page into a chatbot, crawlers that don't run JavaScript. Someone determined can download the font and undo the cipher in a few lines of code. It raises the cost of scraping; it doesn't make anything secret.",
  },
  {
    q: 'What about screenshots and OCR?',
    a: 'Not stopped. The pixels on screen are correct, so anything that reads pixels reads your text.',
  },
  {
    q: 'Will it hurt my SEO?',
    a: 'For the protected text, yes. The server-rendered HTML is scrambled too, so search engines index the gibberish. Protect article bodies, not the pages or headings you want to rank for.',
  },
  {
    q: 'Is it accessible?',
    a: 'Not on its own. Screen readers, find-in-page and copy-paste all see the scrambled text. That is the same mechanism as the protection, not a bug. Leave anything assistive technology needs unprotected, and pair protected text with a readable alternative.',
  },
  {
    q: 'What if the font fails to load?',
    a: 'It fails open: text turns readable again and an error is logged. With JavaScript disabled, protected text stays hidden by default. Set hideUntilReady: false if you would rather show a brief flash of gibberish.',
  },
  {
    q: 'Is it slow?',
    a: 'The font is built once, in the browser, when the page loads. After that each character is one lookup. Kerning is dropped, which you will barely notice in body text.',
  },
  {
    q: 'Does it work with server-side rendering?',
    a: 'Yes, and that is where it matters most. The server writes the scrambled text into the HTML, and the browser rebuilds the matching font from the same seed.',
  },
  {
    q: 'Can I use any of it outside Angular?',
    a: 'Only the low-level parts. The cipher and font builder are plain functions exported from the package, so a build script could pre-scramble static content. Everything else, including keeping text and font in sync, is the Angular layer.',
  },
  {
    q: 'What does the license mean for me?',
    a: "It's AGPL-3.0. If you use it on a public website, that site's source code has to be available under the same license. That is intentional. You also need a font whose license allows embedding.",
  },
];

@Component({
  selector: 'app-faq',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading],
  template: `
    <app-section-heading eyebrow="FAQ" title="Questions you're probably asking" />

    <div class="flex max-w-3xl flex-col gap-2">
      @for (item of questions; track item.q; let first = $first) {
        <details
          class="collapse-arrow bg-base-100 border-base-300 collapse border"
          [attr.open]="first ? '' : null"
        >
          <summary class="collapse-title text-lg font-bold">{{ item.q }}</summary>
          <div class="collapse-content text-base-content/80 text-base leading-relaxed">
            {{ item.a }}
          </div>
        </details>
      }
    </div>
  `,
})
export class Faq {
  protected readonly questions = QUESTIONS;
}

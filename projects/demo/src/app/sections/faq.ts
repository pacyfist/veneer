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
    a: 'Yes. veneer is an Angular library for Angular 20, 21 and 22: the directive, pipe and provideVeneer() are Angular APIs, and it supports SSR and hydration. There is no React or Vue wrapper.',
  },
  {
    q: 'Does it stop AI scrapers completely?',
    a: "No. It stops the cheap, bulk kind: crawlers that read your HTML without running JavaScript, scripts reading innerText, pasting a page into a chatbot. It does not stop a crawler that downloads your JavaScript bundles (text written in your templates is in there), a scraper that knows veneer and downloads the fonts (about 15 lines of code), a headless browser, or OCR. The threat model in the repository has the measured attack costs. It raises the cost of scraping; it doesn't make anything secret.",
  },
  {
    q: 'Is the key in the page?',
    a: "No. With server rendering the server draws the cipher from a secure random source, with no seed at all, forges the font itself and writes only the font's URL into the HTML. A crawler that reads the HTML gets ciphertext and no key. The forged font is the key: anyone who downloads it and your normal font can compare them and undo the cipher, which is the bar veneer sets.",
  },
  {
    q: 'What about screenshots and OCR?',
    a: 'Not stopped. The pixels on screen are correct, so anything that reads pixels reads your text.',
  },
  {
    q: 'Will it hurt my SEO?',
    a: 'For the protected text, yes. Search engines index the server-rendered HTML, and for protected text that is gibberish. Protect article bodies, not the titles, headings and summaries you want to rank for, and keep meta descriptions to a summary. A server-rendered app can serve readable text to search crawlers it has verified by DNS, through the shouldProtect hook; a prerendered site like this one cannot.',
  },
  {
    q: 'Is it accessible?',
    a: "Not while protection is on: screen readers, find-in-page, translation and copy-paste all get the scrambled characters, because that is the protection. The route to accessibility is readable mode: a toggle, like the Readable text button at the top of this page, that switches scrambling off for the visitor and is remembered. withA11y('hide') stops screen readers from reading gibberish aloud, but it hides the text rather than making it accessible. Both are opt-in. Leave links, labels and navigation unprotected.",
  },
  {
    q: 'What is readable mode?',
    a: 'A switch on the page that turns scrambling off for every protected element, for one visitor, and remembers the choice in their browser. The library ships it as a ready-made button. With it on, the page is ordinary text: screen readers, copy, search and translation all work.',
  },
  {
    q: 'What if the font fails to load?',
    a: 'It fails open: text turns readable again, an error with a stable code is logged, and a status listener can report it to your monitoring. With JavaScript disabled, visitors see the scrambled text instead of blank space. One case cannot fail open: on a server-rendered page, if the browser cannot get the base font, the forged font or the forge code (blocked, offline, a redeploy), the server-rendered text stays scrambled, because the readable text is not in that page. veneer retries once and then reports VNR016.',
  },
  {
    q: 'Is it slow?',
    a: 'Building the font takes a few milliseconds: it is your font with only its lookup table replaced, so kerning and ligatures stay. After that each character is one lookup. Visitors download your font (which they usually do anyway) and, on server-rendered pages, the forged font, about the same size.',
  },
  {
    q: 'Does it work with server-side rendering?',
    a: 'Yes, and that is where it matters most. Add provideVeneerServer() on the server: it forges the font and writes the scrambled text into the HTML. A server process uses one cipher for all its requests; a prerendered site like this one shares one cipher per build.',
  },
  {
    q: 'Can I use any of it outside Angular?',
    a: 'Only the low-level parts. The cipher and the font forge are plain functions in their own entry points, so a build script could pre-scramble static content. Everything else, including keeping text and font in sync, is the Angular layer.',
  },
  {
    q: 'What does the license mean for me?',
    a: "It's AGPL-3.0. If you use it on a public website, that site's source code has to be available under the same license. That is intentional. Your font's license must also allow modified versions, because veneer makes a renamed copy of it; the README has a checklist.",
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

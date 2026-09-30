import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * A daisyUI `mockup-code` block with a copy button.
 *
 * `prefix` picks the gutter: line numbers for markup, a `$` for shell commands.
 */
@Component({
  selector: 'app-code-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <div class="mockup-code w-full text-sm">
        @if (file()) {
          <span class="text-neutral-content/50 absolute top-3 left-24 font-mono text-xs">
            {{ file() }}
          </span>
        }
        @for (line of lines(); track $index) {
          <pre
            [attr.data-prefix]="prefix() === 'shell' ? '$' : $index + 1"
          ><code>{{ line }}</code></pre>
        }
      </div>
      <button
        type="button"
        class="btn btn-xs btn-ghost text-neutral-content/70 absolute top-2 right-2"
        (click)="copy()"
      >
        {{ copied() ? 'copied' : 'copy' }}
      </button>
    </div>
  `,
})
export class CodeBlock {
  readonly lines = input.required<readonly string[]>();
  readonly prefix = input<'number' | 'shell'>('number');
  /** Optional file name shown in the block's title bar. */
  readonly file = input<string>('');

  protected readonly copied = signal(false);
  private readonly text = computed(() => this.lines().join('\n'));

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard access denied (insecure context, permissions). The code is
      // still on screen to select by hand.
    }
  }
}

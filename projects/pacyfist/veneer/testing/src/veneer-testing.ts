import {
  EnvironmentProviders,
  Signal,
  WritableSignal,
  computed,
  makeEnvironmentProviders,
  signal,
} from '@angular/core';
import {
  VeneerFailure,
  VeneerFontService,
  VeneerFontState,
  VeneerStatus,
  ɵResolvedVeneerConfig as ResolvedVeneerConfig,
  ɵVENEER_CONFIG as VENEER_CONFIG,
} from '@pacyfist/veneer';
import {
  DEFAULT_CHARSET,
  ScrambleMap,
  buildScrambleMap,
  scrambleText,
} from '@pacyfist/veneer/core';

/**
 * The font states a test can force.
 *
 * - `ready`: the font is "loaded" and text is scrambled. The default.
 * - `loading`: text is scrambled but hidden, as before a real font lands.
 * - `failed`: the font "could not be built"; text stays readable (fail open).
 * - `disabled`: as with `provideVeneer({ disabled: true })`; text stays readable.
 */
export type VeneerTestingState = 'ready' | 'loading' | 'failed' | 'disabled';

export interface VeneerTestingOptions {
  /** Seed for the cipher. Defaults to a fixed value, so tests are reproducible. */
  seed?: number;

  /** Initial state. Defaults to `'ready'`. Change it later with `setState()`. */
  state?: VeneerTestingState;

  /** Codepoints the cipher covers. Defaults to `DEFAULT_CHARSET`. */
  charset?: readonly number[];

  /** Families after the forged one in `fontStack`. Defaults to `'sans-serif'`. */
  fallbackFontFamily?: string;
}

/** Seed used when a test does not pass one. Any fixed value would do. */
const DEFAULT_TESTING_SEED = 0x5eed;

/** What `failed()` carries in the `failed` state. */
const FORCED_FAILURE: VeneerFailure = Object.freeze({
  code: 'VNR010',
  message: '[veneer] font failure forced by provideVeneerTesting()',
});

/** The most recently created stand-in, read by `decodeVeneer()` when no map is passed. */
let current: VeneerTestingFontService | undefined;

/** @internal */
export function currentTestingService(): VeneerTestingFontService | undefined {
  return current;
}

/** @internal */
export function defaultTestingMap(): ScrambleMap {
  return buildScrambleMap(DEFAULT_TESTING_SEED);
}

/**
 * Stands in for `VeneerFontService`: the same cipher and the same signals, but
 * no font is fetched, forged or registered, so nothing touches `FontFace`.
 *
 * Registered by `provideVeneerTesting()` under both this class and
 * `VeneerFontService`. Inject it by this class to change state mid-test:
 *
 * ```ts
 * TestBed.inject(VeneerTestingFontService).setState('failed');
 * ```
 */
export class VeneerTestingFontService implements VeneerFontState {
  private readonly state = signal<VeneerTestingState>('ready');
  private readonly fallbackFontFamily: string;

  private readonly initial: WritableSignal<ScrambleMap | null>;

  readonly initialMap: Signal<ScrambleMap | null>;
  readonly map: Signal<ScrambleMap>;
  readonly familyName: string;

  readonly ready = computed(() => this.state() !== 'loading');
  readonly failed = computed(() => (this.state() === 'failed' ? FORCED_FAILURE : null));
  readonly status = computed<VeneerStatus>(() => {
    const state = this.state();
    return state === 'ready' ? 'active' : state;
  });
  readonly revealed = signal(false);
  readonly active = computed(() => this.state() === 'ready' || this.state() === 'loading');
  readonly fontStack = computed(() =>
    this.active() && !this.revealed()
      ? `"${this.familyName}", ${this.fallbackFontFamily}`
      : this.fallbackFontFamily,
  );
  readonly hidden = computed(() => this.active() && !this.revealed() && !this.ready());

  constructor(options: VeneerTestingOptions = {}) {
    const seed = options.seed ?? DEFAULT_TESTING_SEED;
    const map = buildScrambleMap(seed, options.charset ?? DEFAULT_CHARSET);
    this.initial = signal(map);
    this.initialMap = this.initial.asReadonly();
    this.map = signal(map).asReadonly();
    this.familyName = `Veneer-${seed.toString(36)}`;
    this.fallbackFontFamily = options.fallbackFontFamily ?? 'sans-serif';
    this.state.set(options.state ?? 'ready');
    current = this;
  }

  scramble(text: string): string {
    return this.active() ? scrambleText(text, this.map()) : text;
  }

  /** Force a state, for example to simulate the font failing after first render. */
  setState(state: VeneerTestingState): void {
    this.state.set(state);
  }

  /**
   * Set what `initialMap()` returns: the map server-rendered text was
   * scrambled with. Pass `null` to simulate a client that does not know it
   * yet (it is learned from the forged font), then the map to simulate the
   * moment it arrives. It starts out as the testing cipher's map.
   *
   * ```ts
   * service.setInitialMap(null);   // before the component hydrates
   * // ...render, assert the server's text is left in place...
   * service.setInitialMap(service.map());
   * ```
   */
  setInitialMap(map: ScrambleMap | null): void {
    this.initial.set(map);
  }
}

/**
 * Replaces `provideVeneer()` in tests.
 *
 * ```ts
 * TestBed.configureTestingModule({ providers: [provideVeneerTesting()] });
 * ```
 *
 * Directives, the pipe and anything injecting `VeneerFontService` get a
 * deterministic `VeneerTestingFontService`. The internal config token is
 * provided too, built from the options as they were at setup.
 */
export function provideVeneerTesting(options: VeneerTestingOptions = {}): EnvironmentProviders {
  const config: ResolvedVeneerConfig = {
    font: new ArrayBuffer(0),
    fallbackFontFamily: options.fallbackFontFamily ?? 'sans-serif',
    charset: options.charset ?? DEFAULT_CHARSET,
    hideUntilReady: true,
    disabled: options.state === 'disabled',
    seed: options.seed ?? DEFAULT_TESTING_SEED,
    strictCoverage: false,
    faces: [],
    statusListeners: [],
    statusAttribute: false,
  };
  return makeEnvironmentProviders([
    { provide: VENEER_CONFIG, useValue: config },
    { provide: VeneerTestingFontService, useFactory: () => new VeneerTestingFontService(options) },
    { provide: VeneerFontService, useExisting: VeneerTestingFontService },
  ]);
}

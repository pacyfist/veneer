/*
 * Public API Surface of @pacyfist/no-ai
 */

// Setup
export { provideNoAi, NO_AI_CONFIG } from './lib/no-ai.config';
export type { NoAiConfig, NoAiFontSource, ResolvedNoAiConfig } from './lib/no-ai.config';

// Template pieces
export { NoAiDirective } from './lib/no-ai.directive';
export { NoAiFontDirective } from './lib/no-ai-font.directive';
export { NoAiPipe } from './lib/no-ai.pipe';

// Runtime state: font readiness, failures, and the reveal toggle
export { NoAiFontService } from './lib/no-ai-font.service';

// The framework-free core, exported so the cipher can be reused outside Angular
// — pre-scrambling static content in a build script, for example.
export {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  randomSeed,
  scrambleText,
} from './lib/scramble-map';
export type { ScrambleMap } from './lib/scramble-map';
export { NoAiFontError, forgeScrambledFont, parseBaseFont } from './lib/font-forge';

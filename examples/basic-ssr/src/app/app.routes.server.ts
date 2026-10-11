import { RenderMode, ServerRoute } from '@angular/ssr';

// Rendered per request, unlike the demo site, which is prerendered.
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Server }];

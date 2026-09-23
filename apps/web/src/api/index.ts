// The one seam: VITE_API_MOCK=1 (pnpm dev:mock) swaps in the in-memory fake
// server; everything else in the app imports `api` from here and never
// touches httpApi/mockApi directly.

import { httpApi } from "./http.js";
import { mockApi } from "./mock/index.js";
import type { WorkbenchApi } from "./types.js";

export const api: WorkbenchApi = import.meta.env.VITE_API_MOCK === "1" ? mockApi : httpApi;

export * from "./types.js";
export { qk } from "./queryKeys.js";
export { useEngagementSocket } from "./useEngagementSocket.js";

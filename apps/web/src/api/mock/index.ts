// The mock WorkbenchApi (VITE_API_MOCK=1). A thin adapter over mockBackend so
// its shape is checked against WorkbenchApi at the type level, same as httpApi.

import type { WorkbenchApi } from "../types.js";
import { mockBackend } from "./backend.js";

export const mockApi: WorkbenchApi = mockBackend;

export { __resetMockBackend } from "./backend.js";

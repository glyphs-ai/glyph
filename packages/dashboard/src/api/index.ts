// Aggregate re-export surface for the dashboard's HTTP client.
// Domain modules import transport helpers directly from `./http.js`;
// consumers import resource-specific functions and shared API types here.

export * from "./catalog.js";
export { ApiError, getActiveWorkspace, setActiveWorkspace } from "./http.js";
export * from "./schedules.js";
export * from "./sessions.js";
export * from "./system.js";
export * from "./tasks.js";
export * from "./workflows.js";
export * from "./workspaces.js";

// The manual deployment workflow replaces this file immediately before bundling.
// Null means an unprepared local build, never a claimed production revision.
export const MCP_RELEASE_SOURCE: { source_revision: string | null; bundle_sha256: string | null } = {
  source_revision: null,
  bundle_sha256: null,
};

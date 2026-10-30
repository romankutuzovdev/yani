/** Stub for CRM worker esbuild. */
module.exports = {
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Map(),
};

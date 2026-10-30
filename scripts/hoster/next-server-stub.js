/** Stub for CRM worker esbuild: workers must not load Next.js runtime. */
class NextResponse {
  static json(body, init) {
    return { body, init };
  }
}

module.exports = { NextResponse };

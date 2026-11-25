export class AhaError extends Error {}

type Fetch = typeof globalThis.fetch;

export class AhaClient {
  private readonly origin: string;

  constructor(baseUrl: string | undefined, private readonly token: string | undefined, private readonly request: Fetch = fetch) {
    if (!baseUrl) throw new AhaError("AHA_BASE_URL is not set.");
    if (!token?.trim()) throw new AhaError("AHA_TOKEN is not set.");

    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new AhaError("AHA_BASE_URL must be a valid HTTPS origin.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new AhaError("AHA_BASE_URL must be an HTTPS origin without credentials or a path.");
    }
    this.origin = url.origin;
  }

  async get(path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (!path.startsWith("/api/v3/") || path.includes("?") || path.includes("#")) {
      throw new AhaError("Invalid Aha API path.");
    }
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith("/api/v3/")) {
      throw new AhaError("Invalid Aha API path.");
    }
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await this.request(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": "local-aha-mcp/1.0",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AhaError("Aha request failed or timed out. Check network connectivity and the base URL.");
    }

    if (response.status === 401) throw new AhaError("Aha authentication failed (401). Check AHA_TOKEN.");
    if (response.status === 403) throw new AhaError("Aha access denied (403). Your token may lack permission for this record or API.");
    if (response.status === 404) throw new AhaError("Aha record not found or not accessible (404).");
    if (response.status === 429) throw new AhaError("Aha rate limit reached (429). Wait and retry.");
    if (!response.ok) throw new AhaError(`Aha API returned HTTP ${response.status}.`);
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body as Record<string, unknown>;
    } catch {
      throw new AhaError("Aha returned an invalid JSON response.");
    }
  }
}

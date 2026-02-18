import type {
  SearchResponse,
  ModelSummary,
  OrgSummary,
  Manifest,
  TagInfo,
  PullResponse,
  PushInitResponse,
  PushFinalizeResponse,
  ApiError,
} from "./types.js";

const USER_AGENT = "pullweights-mcp/0.1.0";

export class PullWeightsClient {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor() {
    this.baseUrl = (
      process.env.PULLWEIGHTS_API_URL || "https://api.pullweights.com"
    ).replace(/\/$/, "");
    this.apiKey = process.env.PULLWEIGHTS_API_KEY;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  requireAuth(): void {
    if (!this.apiKey) {
      throw new Error(
        "Authentication required. Set the PULLWEIGHTS_API_KEY environment variable. " +
          "Get your API key at https://pullweights.com/dashboard/api-keys"
      );
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    });

    if (!res.ok) {
      let message: string;
      try {
        const body = (await res.json()) as ApiError | { message?: string };
        message =
          "error" in body
            ? (body as ApiError).error
            : (body as { message?: string }).message || res.statusText;
      } catch {
        message = res.statusText;
      }
      throw new Error(`${res.status}: ${message}`);
    }

    return (await res.json()) as T;
  }

  async search(params: {
    q?: string;
    type?: string;
    per_page?: number;
    framework?: string;
    sort?: string;
    page?: number;
  }): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.type) qs.set("type", params.type);
    if (params.per_page) qs.set("per_page", String(params.per_page));
    if (params.framework) qs.set("framework", params.framework);
    if (params.sort) qs.set("sort", params.sort);
    if (params.page) qs.set("page", String(params.page));
    const query = qs.toString();
    return this.request<SearchResponse>(
      `/v1/search${query ? `?${query}` : ""}`
    );
  }

  async listModels(org: string): Promise<ModelSummary[]> {
    return this.request<ModelSummary[]>(`/v1/models/${encodeURIComponent(org)}`);
  }

  async listOrgs(): Promise<OrgSummary[]> {
    this.requireAuth();
    return this.request<OrgSummary[]>("/v1/orgs");
  }

  async getManifest(org: string, model: string, tag: string): Promise<Manifest> {
    return this.request<Manifest>(
      `/v1/models/${encodeURIComponent(org)}/${encodeURIComponent(model)}/manifests/${encodeURIComponent(tag)}`
    );
  }

  async listTags(org: string, model: string): Promise<TagInfo[]> {
    return this.request<TagInfo[]>(
      `/v1/models/${encodeURIComponent(org)}/${encodeURIComponent(model)}/tags`
    );
  }

  async pull(org: string, model: string, tag: string): Promise<PullResponse> {
    this.requireAuth();
    return this.request<PullResponse>(
      `/v1/models/${encodeURIComponent(org)}/${encodeURIComponent(model)}/pull/${encodeURIComponent(tag)}`
    );
  }

  async pushInit(
    org: string,
    model: string,
    body: {
      tag: string;
      type?: string;
      description?: string;
      visibility?: string;
      files: { filename: string; size_bytes: number; sha256: string }[];
    }
  ): Promise<PushInitResponse> {
    this.requireAuth();
    return this.request<PushInitResponse>(
      `/v1/models/${encodeURIComponent(org)}/${encodeURIComponent(model)}/push/init`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  }

  async uploadToS3(url: string, data: ArrayBuffer): Promise<void> {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.byteLength),
      },
      body: data,
    });
    if (!res.ok) {
      throw new Error(`S3 upload failed: ${res.status} ${res.statusText}`);
    }
  }

  async pushFinalize(
    org: string,
    model: string,
    body: { push_id: string; tag: string }
  ): Promise<PushFinalizeResponse> {
    this.requireAuth();
    return this.request<PushFinalizeResponse>(
      `/v1/models/${encodeURIComponent(org)}/${encodeURIComponent(model)}/push/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  }
}

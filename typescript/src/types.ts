export interface SearchResult {
  id: string;
  org: string;
  name: string;
  description: string | null;
  framework: string | null;
  download_count: number;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  per_page: number;
}

export interface ModelSummary {
  id: string;
  org: string;
  name: string;
  description: string | null;
  visibility: string;
  framework: string | null;
  license: string | null;
  tags: string[];
  download_count: number;
  x402_price_usd: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_personal: boolean;
  member_count: number;
  model_count: number;
  role: string;
  created_at: string;
}

export interface ManifestFile {
  filename: string;
  size_bytes: number;
  sha256: string;
  content_type: string | null;
}

export interface Manifest {
  schema_version: number;
  name: string;
  org: string;
  tag: string;
  description: string | null;
  framework: string | null;
  architecture: string | null;
  license: string | null;
  files: ManifestFile[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TagInfo {
  tag: string;
  version_id: string;
  total_size_bytes: number;
  sha256_digest: string;
  pushed_by: string;
  created_at: string;
}

export interface PullFile {
  filename: string;
  download_url: string;
  sha256: string;
  size_bytes: number;
}

export interface PullResponse {
  org: string;
  model: string;
  tag: string;
  version_id: string;
  sha256_digest: string;
  total_size_bytes: number;
  files: PullFile[];
}

export interface PushInitUpload {
  filename: string;
  s3_key: string;
  upload_url: string;
}

export interface PushInitResponse {
  push_id: string;
  uploads: PushInitUpload[];
}

export interface PushFinalizeFile {
  filename: string;
  size_bytes: number;
  sha256: string;
}

export interface PushFinalizeResponse {
  version_id: string;
  tag: string;
  total_size_bytes: number;
  sha256_digest: string;
  files: PushFinalizeFile[];
}

export interface ApiError {
  error: string;
}

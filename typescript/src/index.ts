#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PullWeightsClient } from "./client.js";

const client = new PullWeightsClient();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseModelRef(ref: string): { org: string; model: string; tag: string } {
  const [modelPart, tag = "latest"] = ref.split(":");
  const parts = modelPart.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid model reference "${ref}". Expected format: org/model or org/model:tag`
    );
  }
  return { org: parts[0], model: parts[1], tag };
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

const server = new McpServer({
  name: "pullweights",
  version: "0.1.0",
});

// --- search ---
server.tool(
  "search",
  "Search PullWeights for models, datasets, and container images",
  {
    query: z.string().optional().describe("Search query string"),
    type: z.enum(["model", "dataset", "container_image"]).optional().describe("Filter by type"),
    framework: z.string().optional().describe("Filter by framework (e.g. pytorch, gguf, safetensors)"),
    sort: z.enum(["downloads", "created", "name", "updated"]).optional().describe("Sort order"),
    per_page: z.number().min(1).max(100).optional().describe("Results per page (default 20)"),
    page: z.number().min(1).optional().describe("Page number"),
  },
  async ({ query, type, framework, sort, per_page, page }) => {
    const res = await client.search({ q: query, type, framework, sort, per_page, page });
    if (res.results.length === 0) {
      return { content: [{ type: "text", text: "No results found." }] };
    }
    const lines = res.results.map((m) => {
      const badge = m.type === "dataset" ? " [dataset]" : m.type === "container_image" ? " [container]" : "";
      return `${m.org}/${m.name}${badge} — ${m.description || "No description"} (${formatBytes(m.download_count)} downloads, ${m.framework || "unknown"})`;
    });
    lines.push(`\nPage ${res.page}/${Math.ceil(res.total / res.per_page)} (${res.total} total)`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// --- ls ---
server.tool(
  "ls",
  "List items in an org (models, datasets, containers), or list your orgs (requires auth)",
  {
    org: z.string().optional().describe("Organization name. Omit to list your orgs."),
  },
  async ({ org }) => {
    if (org) {
      const models = await client.listModels(org);
      if (models.length === 0) {
        return { content: [{ type: "text", text: `No items found in ${org}.` }] };
      }
      const lines = models.map((m) => {
        const badge = m.type === "dataset" ? " [dataset]" : m.type === "container_image" ? " [container]" : "";
        return `${m.org}/${m.name}${badge}:${m.tags[0] || "latest"} — ${m.description || "No description"} [${m.visibility}]`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    const orgs = await client.listOrgs();
    if (orgs.length === 0) {
      return { content: [{ type: "text", text: "No organizations found." }] };
    }
    const lines = orgs.map(
      (o) =>
        `${o.name}${o.is_personal ? " (personal)" : ""} — ${o.model_count} items, ${o.member_count} members [${o.role}]`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// --- inspect ---
server.tool(
  "inspect",
  "Get the manifest for a model version (files, checksums, metadata)",
  {
    model: z.string().describe("Model reference: org/model or org/model:tag"),
  },
  async ({ model }) => {
    const ref = parseModelRef(model);
    const manifest = await client.getManifest(ref.org, ref.model, ref.tag);
    const lines = [
      `${manifest.org}/${manifest.name}:${manifest.tag}`,
      `Schema: v${manifest.schema_version}`,
    ];
    if (manifest.description) lines.push(`Description: ${manifest.description}`);
    if (manifest.framework) lines.push(`Framework: ${manifest.framework}`);
    if (manifest.architecture) lines.push(`Architecture: ${manifest.architecture}`);
    if (manifest.license) lines.push(`License: ${manifest.license}`);
    lines.push(`Created: ${manifest.created_at}`);
    lines.push(`\nFiles (${manifest.files.length}):`);
    for (const f of manifest.files) {
      lines.push(`  ${f.filename} — ${formatBytes(f.size_bytes)} (sha256:${f.sha256.slice(0, 12)}…)`);
    }
    const totalSize = manifest.files.reduce((s, f) => s + f.size_bytes, 0);
    lines.push(`\nTotal size: ${formatBytes(totalSize)}`);
    if (Object.keys(manifest.metadata).length > 0) {
      lines.push(`\nMetadata: ${JSON.stringify(manifest.metadata, null, 2)}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// --- tags ---
server.tool(
  "tags",
  "List available tags for a model",
  {
    model: z.string().describe("Model reference: org/model"),
  },
  async ({ model }) => {
    const parts = model.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid model reference "${model}". Expected format: org/model`);
    }
    const [org, name] = parts;
    const tags = await client.listTags(org, name);
    if (tags.length === 0) {
      return { content: [{ type: "text", text: `No tags found for ${model}.` }] };
    }
    const lines = tags.map(
      (t) =>
        `${t.tag} — ${formatBytes(t.total_size_bytes)} (digest:${t.sha256_digest.slice(0, 12)}…) pushed ${t.created_at}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// --- update ---
server.tool(
  "update",
  "Update model metadata (description, visibility, framework, license, tags)",
  {
    model: z.string().describe("Model reference: org/model"),
    description: z.string().optional().describe("New description (supports markdown, up to 50,000 chars)"),
    visibility: z.enum(["public", "private"]).optional().describe("Visibility"),
    framework: z.string().optional().describe("Framework (e.g. pytorch, tensorflow, gguf)"),
    license: z.string().optional().describe("License (e.g. MIT, Apache-2.0)"),
    tags: z.array(z.string()).optional().describe("Tags/labels for the model"),
  },
  async ({ model, description, visibility, framework, license, tags }) => {
    const parts = model.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid model reference "${model}". Expected format: org/model`);
    }
    const [org, name] = parts;
    const body: Record<string, unknown> = {};
    if (description !== undefined) body.description = description;
    if (visibility !== undefined) body.visibility = visibility;
    if (framework !== undefined) body.framework = framework;
    if (license !== undefined) body.license = license;
    if (tags !== undefined) body.tags = tags;

    if (Object.keys(body).length === 0) {
      return { content: [{ type: "text", text: "No fields to update. Provide at least one of: description, visibility, framework, license, tags." }] };
    }

    const res = await client.updateModel(org, name, body as Parameters<typeof client.updateModel>[2]);
    return { content: [{ type: "text", text: `Updated ${org}/${name}: ${res.message}` }] };
  }
);

// --- pull ---
server.tool(
  "pull",
  "Download files for a model or dataset to disk with SHA-256 verification",
  {
    model: z.string().describe("Model reference: org/model or org/model:tag"),
    output_dir: z
      .string()
      .optional()
      .describe("Output directory (default: ./pullweights_models/org/model/tag)"),
  },
  async ({ model, output_dir }) => {
    const ref = parseModelRef(model);
    const pullRes = await client.pull(ref.org, ref.model, ref.tag);

    const destDir =
      output_dir ||
      resolve("pullweights_models", ref.org, ref.model, ref.tag);
    await mkdir(destDir, { recursive: true });

    const downloaded: string[] = [];
    for (const file of pullRes.files) {
      const filePath = join(destDir, file.filename);
      const res = await fetch(file.download_url, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(`Failed to download ${file.filename}: ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      const checksum = sha256(buffer);
      if (checksum !== file.sha256) {
        throw new Error(
          `Checksum mismatch for ${file.filename}: expected ${file.sha256}, got ${checksum}`
        );
      }

      await writeFile(filePath, buffer);
      downloaded.push(`${file.filename} — ${formatBytes(file.size_bytes)} ✓`);
    }

    const lines = [
      `Downloaded ${ref.org}/${ref.model}:${ref.tag} to ${destDir}`,
      `Digest: ${pullRes.sha256_digest}`,
      `Total: ${formatBytes(pullRes.total_size_bytes)}`,
      "",
      ...downloaded,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// --- push ---
server.tool(
  "push",
  "Upload files to PullWeights (two-phase: init, upload to S3, finalize)",
  {
    model: z.string().describe("Model reference: org/model:tag"),
    files: z
      .array(z.string())
      .min(1)
      .describe("Absolute file paths to upload"),
    type: z
      .enum(["model", "dataset", "container_image"])
      .optional()
      .describe("Item type (default: model)"),
    description: z.string().optional().describe("Description"),
    visibility: z
      .enum(["public", "private"])
      .optional()
      .describe("Visibility (default: public)"),
  },
  async ({ model, files, type: itemType, description, visibility }) => {
    const ref = parseModelRef(model);
    if (ref.tag === "latest" && !model.includes(":")) {
      throw new Error("Push requires an explicit tag. Use org/model:tag format.");
    }

    // Compute checksums and sizes
    const fileInfos = await Promise.all(
      files.map(async (filePath) => {
        const data = await readFile(filePath);
        const stats = await stat(filePath);
        return {
          path: filePath,
          filename: filePath.split("/").pop()!,
          size_bytes: stats.size,
          sha256: sha256(data),
          data,
        };
      })
    );

    // Phase 1: init
    const initRes = await client.pushInit(ref.org, ref.model, {
      tag: ref.tag,
      type: itemType,
      description,
      visibility,
      files: fileInfos.map((f) => ({
        filename: f.filename,
        size_bytes: f.size_bytes,
        sha256: f.sha256,
      })),
    });

    // Phase 2: upload to S3
    for (const upload of initRes.uploads) {
      const fileInfo = fileInfos.find((f) => f.filename === upload.filename);
      if (!fileInfo) {
        throw new Error(`No local file found for ${upload.filename}`);
      }
      await client.uploadToS3(
        upload.upload_url,
        fileInfo.data.buffer.slice(
          fileInfo.data.byteOffset,
          fileInfo.data.byteOffset + fileInfo.data.byteLength
        ) as ArrayBuffer
      );
    }

    // Phase 3: finalize
    const finalRes = await client.pushFinalize(ref.org, ref.model, {
      push_id: initRes.push_id,
      tag: ref.tag,
    });

    const lines = [
      `Pushed ${ref.org}/${ref.model}:${ref.tag}`,
      `Version: ${finalRes.version_id}`,
      `Digest: ${finalRes.sha256_digest}`,
      `Total: ${formatBytes(finalRes.total_size_bytes)}`,
      "",
      ...finalRes.files.map(
        (f) => `  ${f.filename} — ${formatBytes(f.size_bytes)} (sha256:${f.sha256.slice(0, 12)}…)`
      ),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

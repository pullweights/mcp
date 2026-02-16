"""PullWeights MCP server — tool handlers and entry point."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from pathlib import Path
from typing import Any

from mcp.server.lowlevel import Server
import mcp.server.stdio
import mcp.types as types

from .client import PullWeightsClient, AuthRequired, ApiError

server = Server("pullweights")
client = PullWeightsClient()


def _format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def _parse_model_ref(ref: str) -> tuple[str, str, str]:
    """Parse 'org/model:tag' into (org, model, tag). Tag defaults to 'latest'."""
    model_part, _, tag = ref.partition(":")
    if not tag:
        tag = "latest"
    parts = model_part.split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(
            f'Invalid model reference "{ref}". Expected format: org/model or org/model:tag'
        )
    return parts[0], parts[1], tag


def _text(text: str) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    return [types.TextContent(type="text", text=text)]


@server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="search",
            description="Search PullWeights for AI models by query, framework, or sort order",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query string"},
                    "framework": {
                        "type": "string",
                        "description": "Filter by framework (e.g. pytorch, gguf, safetensors)",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["downloads", "created", "name", "updated"],
                        "description": "Sort order",
                    },
                    "per_page": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Results per page (default 20)",
                    },
                    "page": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Page number",
                    },
                },
            },
        ),
        types.Tool(
            name="ls",
            description="List models in an org, or list your orgs (requires auth)",
            inputSchema={
                "type": "object",
                "properties": {
                    "org": {
                        "type": "string",
                        "description": "Organization name. Omit to list your orgs.",
                    },
                },
            },
        ),
        types.Tool(
            name="inspect",
            description="Get the manifest for a model version (files, checksums, metadata)",
            inputSchema={
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "description": "Model reference: org/model or org/model:tag",
                    },
                },
                "required": ["model"],
            },
        ),
        types.Tool(
            name="tags",
            description="List available tags for a model",
            inputSchema={
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "description": "Model reference: org/model",
                    },
                },
                "required": ["model"],
            },
        ),
        types.Tool(
            name="pull",
            description="Download a model's files to disk with SHA-256 verification",
            inputSchema={
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "description": "Model reference: org/model or org/model:tag",
                    },
                    "output_dir": {
                        "type": "string",
                        "description": (
                            "Output directory (default: ./pullweights_models/org/model/tag)"
                        ),
                    },
                },
                "required": ["model"],
            },
        ),
        types.Tool(
            name="push",
            description=(
                "Upload model files to PullWeights (two-phase: init, upload to S3, finalize)"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "description": "Model reference: org/model:tag",
                    },
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "description": "Absolute file paths to upload",
                    },
                    "description": {
                        "type": "string",
                        "description": "Model description",
                    },
                    "visibility": {
                        "type": "string",
                        "enum": ["public", "private"],
                        "description": "Model visibility (default: public)",
                    },
                },
                "required": ["model", "files"],
            },
        ),
    ]


@server.call_tool()  # type: ignore[untyped-decorator]
async def call_tool(
    name: str, arguments: dict[str, Any]
) -> list[
    types.TextContent
    | types.ImageContent
    | types.AudioContent
    | types.ResourceLink
    | types.EmbeddedResource
]:
    try:
        if name == "search":
            return await _handle_search(arguments)
        elif name == "ls":
            return await _handle_ls(arguments)
        elif name == "inspect":
            return await _handle_inspect(arguments)
        elif name == "tags":
            return await _handle_tags(arguments)
        elif name == "pull":
            return await _handle_pull(arguments)
        elif name == "push":
            return await _handle_push(arguments)
        else:
            return _text(f"Unknown tool: {name}")
    except (AuthRequired, ApiError, ValueError, OSError) as e:
        return _text(str(e))


async def _handle_search(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    res = await client.search(
        q=args.get("query"),
        framework=args.get("framework"),
        sort=args.get("sort"),
        per_page=args.get("per_page"),
        page=args.get("page"),
    )
    results = res["results"]
    if not results:
        return _text("No models found.")
    lines = [
        f"{m['org']}/{m['name']} — {m.get('description') or 'No description'} "
        f"({_format_bytes(m['download_count'])} downloads, {m.get('framework') or 'unknown'})"
        for m in results
    ]
    total_pages = math.ceil(res["total"] / res["per_page"])
    lines.append(f"\nPage {res['page']}/{total_pages} ({res['total']} total)")
    return _text("\n".join(lines))


async def _handle_ls(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    org = args.get("org")
    if org:
        models = await client.list_models(org)
        if not models:
            return _text(f"No models found in {org}.")
        lines = [
            f"{m['org']}/{m['name']}:{(m.get('tags') or ['latest'])[0]} — "
            f"{m.get('description') or 'No description'} [{m['visibility']}]"
            for m in models
        ]
        return _text("\n".join(lines))
    orgs = await client.list_orgs()
    if not orgs:
        return _text("No organizations found.")
    lines = [
        f"{o['name']}{' (personal)' if o.get('is_personal') else ''} — "
        f"{o['model_count']} models, {o['member_count']} members [{o['role']}]"
        for o in orgs
    ]
    return _text("\n".join(lines))


async def _handle_inspect(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    org, model, tag = _parse_model_ref(args["model"])
    manifest = await client.get_manifest(org, model, tag)
    lines = [
        f"{manifest['org']}/{manifest['name']}:{manifest['tag']}",
        f"Schema: v{manifest['schema_version']}",
    ]
    if manifest.get("description"):
        lines.append(f"Description: {manifest['description']}")
    if manifest.get("framework"):
        lines.append(f"Framework: {manifest['framework']}")
    if manifest.get("architecture"):
        lines.append(f"Architecture: {manifest['architecture']}")
    if manifest.get("license"):
        lines.append(f"License: {manifest['license']}")
    lines.append(f"Created: {manifest['created_at']}")

    files = manifest["files"]
    lines.append(f"\nFiles ({len(files)}):")
    for f in files:
        lines.append(
            f"  {f['filename']} — {_format_bytes(f['size_bytes'])} "
            f"(sha256:{f['sha256'][:12]}…)"
        )
    total = sum(f["size_bytes"] for f in files)
    lines.append(f"\nTotal size: {_format_bytes(total)}")

    metadata = manifest.get("metadata", {})
    if metadata:
        lines.append(f"\nMetadata: {json.dumps(metadata, indent=2)}")
    return _text("\n".join(lines))


async def _handle_tags(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    ref = args["model"]
    parts = ref.split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f'Invalid model reference "{ref}". Expected format: org/model')
    org, model = parts
    tags = await client.list_tags(org, model)
    if not tags:
        return _text(f"No tags found for {ref}.")
    lines = [
        f"{t['tag']} — {_format_bytes(t['total_size_bytes'])} "
        f"(digest:{t['sha256_digest'][:12]}…) pushed {t['created_at']}"
        for t in tags
    ]
    return _text("\n".join(lines))


async def _handle_pull(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    org, model, tag = _parse_model_ref(args["model"])
    pull_res = await client.pull(org, model, tag)

    output_dir = args.get("output_dir") or str(
        Path("pullweights_models") / org / model / tag
    )
    dest = Path(output_dir)
    dest.mkdir(parents=True, exist_ok=True)

    downloaded: list[str] = []
    for file_info in pull_res["files"]:
        data = await client.download_file(file_info["download_url"])

        checksum = hashlib.sha256(data).hexdigest()
        if checksum != file_info["sha256"]:
            raise ValueError(
                f"Checksum mismatch for {file_info['filename']}: "
                f"expected {file_info['sha256']}, got {checksum}"
            )

        file_path = dest / file_info["filename"]
        file_path.write_bytes(data)
        downloaded.append(
            f"{file_info['filename']} — {_format_bytes(file_info['size_bytes'])} ✓"
        )

    lines = [
        f"Downloaded {org}/{model}:{tag} to {dest}",
        f"Digest: {pull_res['sha256_digest']}",
        f"Total: {_format_bytes(pull_res['total_size_bytes'])}",
        "",
        *downloaded,
    ]
    return _text("\n".join(lines))


async def _handle_push(
    args: dict[str, Any],
) -> list[types.TextContent | types.ImageContent | types.AudioContent | types.ResourceLink | types.EmbeddedResource]:
    org, model, tag = _parse_model_ref(args["model"])
    if tag == "latest" and ":" not in args["model"]:
        raise ValueError("Push requires an explicit tag. Use org/model:tag format.")

    file_paths = [Path(f) for f in args["files"]]
    file_infos: list[dict[str, Any]] = []
    for fp in file_paths:
        data = fp.read_bytes()
        file_infos.append({
            "path": fp,
            "filename": fp.name,
            "size_bytes": fp.stat().st_size,
            "sha256": hashlib.sha256(data).hexdigest(),
            "data": data,
        })

    # Phase 1: init
    init_res = await client.push_init(org, model, {
        "tag": tag,
        "description": args.get("description"),
        "visibility": args.get("visibility"),
        "files": [
            {"filename": f["filename"], "size_bytes": f["size_bytes"], "sha256": f["sha256"]}
            for f in file_infos
        ],
    })

    # Phase 2: upload to S3
    for upload in init_res["uploads"]:
        info = next(f for f in file_infos if f["filename"] == upload["filename"])
        await client.upload_to_s3(upload["upload_url"], info["data"])

    # Phase 3: finalize
    final_res = await client.push_finalize(org, model, {
        "push_id": init_res["push_id"],
        "tag": tag,
    })

    lines = [
        f"Pushed {org}/{model}:{tag}",
        f"Version: {final_res['version_id']}",
        f"Digest: {final_res['sha256_digest']}",
        f"Total: {_format_bytes(final_res['total_size_bytes'])}",
        "",
        *[
            f"  {f['filename']} — {_format_bytes(f['size_bytes'])} "
            f"(sha256:{f['sha256'][:12]}…)"
            for f in final_res["files"]
        ],
    ]
    return _text("\n".join(lines))


def main() -> None:
    asyncio.run(_run())


async def _run() -> None:
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

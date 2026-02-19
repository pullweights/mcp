"""HTTP client for the PullWeights API."""

from __future__ import annotations

import os
from typing import Any

import httpx

USER_AGENT = "pullweights-mcp/0.1.0"


class AuthRequired(Exception):
    """Raised when an API key is required but not set."""


class ApiError(Exception):
    """Raised on non-2xx API responses."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status


class PullWeightsClient:
    def __init__(self) -> None:
        base = os.environ.get("PULLWEIGHTS_API_URL", "https://api.pullweights.com")
        self.base_url = base.rstrip("/")
        self.api_key = os.environ.get("PULLWEIGHTS_API_KEY")
        self._client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=120.0,
            follow_redirects=True,
        )

    def _auth_headers(self) -> dict[str, str]:
        if self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

    def require_auth(self) -> None:
        if not self.api_key:
            raise AuthRequired(
                "Authentication required. Set the PULLWEIGHTS_API_KEY environment variable. "
                "Get your API key at https://pullweights.com/dashboard/api-keys"
            )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        resp = await self._client.request(
            method, url, params=params, json=json, headers=self._auth_headers()
        )
        if resp.status_code >= 400:
            try:
                body = resp.json()
                message = body.get("error") or body.get("message") or resp.reason_phrase
            except Exception:
                message = resp.reason_phrase
            raise ApiError(resp.status_code, str(message))
        return resp.json()

    async def search(
        self,
        *,
        q: str | None = None,
        type: str | None = None,
        framework: str | None = None,
        sort: str | None = None,
        per_page: int | None = None,
        page: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if q:
            params["q"] = q
        if type:
            params["type"] = type
        if framework:
            params["framework"] = framework
        if sort:
            params["sort"] = sort
        if per_page:
            params["per_page"] = per_page
        if page:
            params["page"] = page
        result: dict[str, Any] = await self._request("GET", "/v1/search", params=params)
        return result

    async def list_models(self, org: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = await self._request(
            "GET", f"/v1/models/{_encode(org)}"
        )
        return result

    async def list_orgs(self) -> list[dict[str, Any]]:
        self.require_auth()
        result: list[dict[str, Any]] = await self._request("GET", "/v1/orgs")
        return result

    async def get_manifest(self, org: str, model: str, tag: str) -> dict[str, Any]:
        result: dict[str, Any] = await self._request(
            "GET",
            f"/v1/models/{_encode(org)}/{_encode(model)}/manifests/{_encode(tag)}",
        )
        return result

    async def list_tags(self, org: str, model: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = await self._request(
            "GET", f"/v1/models/{_encode(org)}/{_encode(model)}/tags"
        )
        return result

    async def pull(self, org: str, model: str, tag: str) -> dict[str, Any]:
        self.require_auth()
        result: dict[str, Any] = await self._request(
            "GET",
            f"/v1/models/{_encode(org)}/{_encode(model)}/pull/{_encode(tag)}",
        )
        return result

    async def update_model(
        self,
        org: str,
        model: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        self.require_auth()
        result: dict[str, Any] = await self._request(
            "PATCH",
            f"/v1/models/{_encode(org)}/{_encode(model)}",
            json=body,
        )
        return result

    async def push_init(
        self,
        org: str,
        model: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        self.require_auth()
        result: dict[str, Any] = await self._request(
            "POST",
            f"/v1/models/{_encode(org)}/{_encode(model)}/push/init",
            json=body,
        )
        return result

    async def upload_to_s3(self, url: str, data: bytes) -> None:
        resp = await self._client.put(
            url,
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        )
        if resp.status_code >= 400:
            raise ApiError(resp.status_code, f"S3 upload failed: {resp.reason_phrase}")

    async def push_finalize(
        self,
        org: str,
        model: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        self.require_auth()
        result: dict[str, Any] = await self._request(
            "POST",
            f"/v1/models/{_encode(org)}/{_encode(model)}/push/finalize",
            json=body,
        )
        return result

    async def download_file(self, url: str) -> bytes:
        resp = await self._client.get(url)
        if resp.status_code >= 400:
            raise ApiError(resp.status_code, f"Download failed: {resp.reason_phrase}")
        return resp.content


def _encode(s: str) -> str:
    return httpx.URL(f"/{s}").path.lstrip("/")

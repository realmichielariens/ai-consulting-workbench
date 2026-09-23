// Asset viewer: rendered Markdown of the selected version, version list
// newest first, Download.

import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EngagementId, ItemId, SlotName, Version } from "@workbench/core";
import { api, qk } from "../api/index.js";
import { selectAsset } from "../state/url.js";

export function AssetViewer({ eid, itemId, slot, version }: { eid: EngagementId; itemId: ItemId; slot: SlotName; version: Version | null }) {
  const versions = useQuery({ queryKey: qk.assetVersions(eid, itemId, slot), queryFn: () => api.getAssetVersions(eid, itemId, slot) });
  const resolvedVersion = version ?? versions.data?.versions[0]?.version ?? null;
  const content = useQuery({
    queryKey: qk.assetVersion(eid, itemId, slot, resolvedVersion ?? ""),
    queryFn: () => api.getAssetVersion(eid, itemId, slot, resolvedVersion!),
    enabled: resolvedVersion != null,
  });

  if (versions.status === "pending") return <p>Loading asset…</p>;
  if (versions.status === "error") return <p role="alert">Could not load versions: {(versions.error as Error).message}</p>;

  return (
    <div className="asset-viewer" data-testid="asset-viewer" data-slot={`${itemId}/${slot}`}>
      <h2>
        {itemId}/{slot}
      </h2>
      <p className="muted">{versions.data.description}</p>

      <div className="asset-viewer-body">
        <div className="asset-content">
          {content.status === "pending" && <p>Loading version…</p>}
          {content.status === "error" && <p role="alert">Could not load this version: {(content.error as Error).message}</p>}
          {content.status === "success" &&
            (content.data.text != null ? (
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.data.text}</ReactMarkdown>
              </div>
            ) : (
              <p>
                Binary file —{" "}
                <a href={api.getAssetRawUrl(eid, itemId, slot, content.data.version.version)} download>
                  download
                </a>
              </p>
            ))}
          {resolvedVersion && (
            <a className="download-link" href={api.getAssetRawUrl(eid, itemId, slot, resolvedVersion)} download data-testid="asset-download">
              Download v{resolvedVersion}
            </a>
          )}
        </div>

        <ul className="asset-version-list" data-testid="asset-version-list">
          {versions.data.versions.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                className={`link ${v.version === resolvedVersion ? "active" : ""}`}
                data-testid={`asset-version-${v.version}`}
                onClick={() => selectAsset(itemId, slot, v.version)}
              >
                v{v.version} ({v.kind}) — {v.author}
              </button>
              <div className="muted">
                {new Date(v.at).toLocaleString()} {v.note && `— ${v.note}`}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

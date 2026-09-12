"use client";
import type { Document, Flag } from "@/db/schema";
import type { Iso } from "@/lib/queries";
import { Chip } from "@/components/ui/Chip";
import { FileIcon, ImageIcon, PdfIcon } from "@/components/ui/icons";
import { CitationBlock } from "./CitationBlock";

/**
 * The right-hand column (spec §3.6: "evidence panel showing the relevant document
 * beside the flag").
 *
 * With a flag selected it shows that flag's documents and its source. With nothing
 * selected it lists the packet, so the panel is never empty. Document bytes come from
 * GET /api/documents/:id, which requires a paralegal session — they are never inlined
 * into the page.
 */

export type EvidencePanelProps = {
  documents: Iso<Omit<Document, "storageUrl">>[];
  selectedFlag: Iso<Flag> | null;
};

export function EvidencePanel({ documents, selectedFlag }: EvidencePanelProps) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const shown = selectedFlag
    ? selectedFlag.evidenceDocumentIds.map((id) => byId.get(id)).filter((d): d is Iso<Omit<Document, "storageUrl">> => Boolean(d))
    : documents;

  return (
    <aside aria-label="Evidence" className="panel flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-label">{selectedFlag ? "Evidence for this flag" : "Documents in the packet"}</h2>
        <span className="text-xs text-muted">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-[var(--radius-tile)] bg-surface px-4 py-6 text-center text-sm leading-relaxed text-muted">
          {selectedFlag
            ? "This flag is about the packet as a whole rather than one document."
            : "No documents have been received yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((doc) => (
            <li key={doc.id}>
              <DocumentPreview doc={doc} />
            </li>
          ))}
        </ul>
      )}

      {selectedFlag ? (
        <div>
          <h3 className="section-label mb-2">Source</h3>
          <CitationBlock citation={selectedFlag.sourceCitation} />
        </div>
      ) : null}
    </aside>
  );
}

function DocumentPreview({ doc }: { doc: Iso<Omit<Document, "storageUrl">> }) {
  const href = `/api/documents/${doc.id}`;
  const isImage = (doc.mimeType ?? "").startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";
  const fields = Object.entries(doc.extracted?.fields ?? {}).filter(([, v]) => v);

  return (
    <div className="overflow-hidden rounded-[var(--radius-tile)] bg-surface">
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- the bytes come from an authenticated API route, not a static asset
          <img src={href} alt={doc.originalFilename ?? "Document"} className="max-h-56 w-full bg-bg object-contain" />
        ) : (
          <div className="flex h-24 items-center justify-center bg-bg text-muted">
            {isPdf ? <PdfIcon size={28} /> : <FileIcon size={28} />}
          </div>
        )}
      </a>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-xs font-medium text-ink" title={doc.originalFilename ?? undefined}>
            {doc.originalFilename ?? "Document"}
          </span>
          {doc.legibilityOk === false ? (
            <Chip tone="error">Illegible</Chip>
          ) : doc.legibilityOk === true ? (
            <Chip tone="ok">Legible</Chip>
          ) : (
            <Chip tone="neutral">Not checked</Chip>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-[0.7rem] text-muted">
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={11} />
            {doc.verifiedType ?? doc.extracted?.docType ?? "unrecognized"}
          </span>
          <span>· received by {doc.receivedVia}</span>
        </div>
        {fields.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[0.7rem]">
            {fields.slice(0, 6).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate text-ink" title={v ?? undefined}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {doc.extracted?.legibilityNotes ? (
          <p className="text-[0.7rem] leading-relaxed text-muted">{doc.extracted.legibilityNotes}</p>
        ) : null}
      </div>
    </div>
  );
}

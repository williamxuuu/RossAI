"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { classifySelection, readerPageUrl, type Frame } from "@/lib/jargon/selection";
import { detectFormNumber } from "@/lib/jargon/formHint";
import { JargonOverlay, type JargonSelection } from "./JargonOverlay";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ChevronIcon, PdfIcon } from "@/components/ui/icons";

/**
 * A PDF reader with the jargon overlay attached (spec §3.2, in-page).
 *
 * Select a term on the page and the card in ./JargonOverlay.tsx appears next to it
 * with a plain-language explanation and the USCIS passage it came from. The overlay
 * needs real selectable text, so pages are drawn as a canvas with pdf.js's text
 * layer over them — the same thing the Chrome extension attaches to on a USCIS page.
 *
 * A document the client opens from their own device is read in the browser and never
 * uploaded: the only thing that leaves the page is the term they selected (spec §4.5).
 */

export type PdfReaderProps = {
  /** A PDF served by this app, shown until the client opens one of their own. */
  sampleUrl: string;
  sampleLabel: string;
  /** Explain in this language (BCP-47 primary subtag; see `SUPPORTED_LANGUAGES`). */
  language: string;
};

/** Horizontal padding inside the scroll container, kept in sync with the class below. */
const VIEWPORT_PADDING = 16;
const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;

type Source =
  | { kind: "sample"; url: string; name: string }
  /** Bytes read from the client's device. They stay in this tab. */
  | { kind: "local"; bytes: ArrayBuffer; name: string };

type Status = "loading" | "ready" | "error";

export function PdfReader({ sampleUrl, sampleLabel, language }: PdfReaderProps) {
  const [source, setSource] = useState<Source>({ kind: "sample", url: sampleUrl, name: sampleLabel });
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [formHint, setFormHint] = useState<string | undefined>(undefined);
  const [available, setAvailable] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [selection, setSelection] = useState<{ selection: JargonSelection; frame: Frame; pageUrl: string } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const clearSelection = useCallback(() => setSelection(null), []);

  /**
   * Switch documents. Page, zoom and any open card belong to the document being
   * left, so they are reset here rather than in the effect below — which then only
   * ever touches state once its await has resolved.
   */
  const openSource = useCallback((next: Source) => {
    setSource(next);
    // Drop the old document with it: the effect below destroys it on the way out, and
    // a render against a destroyed document would fail for no reason the client can act on.
    setDoc(null);
    setStatus("loading");
    setError(null);
    setSelection(null);
    setPage(1);
  }, []);

  // --- the document ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument(
          source.kind === "sample"
            ? { url: source.url }
            : // pdf.js takes ownership of the buffer it is handed, so it gets a copy —
              // the original has to survive a re-render or a zoom change.
              { data: new Uint8Array(source.bytes.slice(0)) },
        );
        loaded = await task.promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        const title = await documentTitle(loaded);
        setDoc(loaded);
        setFormHint(detectFormNumber(title ?? "", source.name));
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("error");
        setError(
          source.kind === "local"
            ? "That file could not be opened as a PDF. Try another file."
            : "The document could not be loaded. Reload the page to try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [source]);

  // --- fit to the width we actually have -----------------------------------
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => setAvailable(Math.max(240, vp.clientWidth - VIEWPORT_PADDING * 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(vp);
    return () => observer.disconnect();
  }, []);

  // --- the page ------------------------------------------------------------
  useEffect(() => {
    if (!doc || available === 0) return;
    const canvas = canvasRef.current;
    const layer = textLayerRef.current;
    if (!canvas || !layer) return;

    let cancelled = false;
    let task: RenderTask | null = null;
    setRendering(true);

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = (available / unscaled.width) * ZOOM_STEPS[zoomIndex];
        const viewport = pdfPage.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        task = pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
        if (cancelled) return;

        // The text layer is positioned off --scale-factor, so it has to be set before
        // pdf.js lays the spans out, and it has to match the scale the canvas was drawn at.
        layer.replaceChildren();
        layer.style.setProperty("--scale-factor", String(scale));
        const text = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: layer, viewport });
        await text.render();
      } catch (err) {
        if (cancelled || isCancelled(err)) return;
        setStatus("error");
        setError("This page could not be drawn.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoomIndex, available]);

  // --- selection -----------------------------------------------------------
  const readSelection = useCallback(() => {
    const content = contentRef.current;
    const vp = viewportRef.current;
    if (!content || !vp) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !content.contains(sel.anchorNode)) return;

    const verdict = classifySelection(sel.toString());
    if (verdict.kind === "ignore") {
      setSelection(null);
      return;
    }

    const box = content.getBoundingClientRect();
    const view = vp.getBoundingClientRect();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({
      selection: {
        text: verdict.text,
        tooLong: verdict.kind === "too_long",
        rect: { top: r.top - box.top, left: r.left - box.left, bottom: r.bottom - box.top, right: r.right - box.left },
      },
      frame: { width: box.width, height: box.height, scrollTop: view.top - box.top, viewHeight: view.height },
      pageUrl: readerPageUrl(window.location.origin, window.location.pathname, formHint),
    });
  }, [formHint]);

  useEffect(() => {
    const onMouseUp = () => window.setTimeout(readSelection, 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith("Arrow")) window.setTimeout(readSelection, 0);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [readSelection, clearSelection]);

  const pages = doc?.numPages ?? 0;

  return (
    <section className="panel flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted">
            <PdfIcon size={20} />
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-ink" title={source.name}>
            {source.name}
          </span>
          {formHint ? <Chip tone="neutral">{formHint}</Chip> : null}
        </span>

        <span className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous page"
              disabled={page <= 1 || status !== "ready"}
              onClick={() => {
                clearSelection();
                setPage((p) => Math.max(1, p - 1));
              }}
            >
              <span className="rotate-180">
                <ChevronIcon size={16} />
              </span>
            </Button>
            <span className="min-w-[5.5rem] text-center text-xs text-muted" aria-live="polite">
              {pages > 0 ? `Page ${page} of ${pages}` : "—"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next page"
              disabled={page >= pages || status !== "ready"}
              onClick={() => {
                clearSelection();
                setPage((p) => Math.min(pages, p + 1));
              }}
            >
              <ChevronIcon size={16} />
            </Button>
          </span>

          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              onClick={() => {
                clearSelection();
                setZoomIndex((z) => Math.max(0, z - 1));
              }}
            >
              −
            </Button>
            <span className="w-10 text-center text-xs text-muted">{Math.round(ZOOM_STEPS[zoomIndex] * 100)}%</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
              onClick={() => {
                clearSelection();
                setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1));
              }}
            >
              +
            </Button>
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilePicker
          onPick={(file, bytes) => {
            openSource({ kind: "local", bytes, name: file.name });
          }}
        />
        {source.kind === "local" ? (
          <Button size="sm" variant="ghost" onClick={() => openSource({ kind: "sample", url: sampleUrl, name: sampleLabel })}>
            Back to the practice form
          </Button>
        ) : null}
        <span className="text-xs leading-relaxed text-muted">
          A file you open stays on your device — only the words you select are sent to the clinic.
        </span>
      </div>

      <div
        ref={viewportRef}
        onMouseDown={clearSelection}
        className="relative max-h-[72vh] overflow-auto rounded-[var(--radius-tile)] bg-surface p-4"
      >
        <div ref={contentRef} className="relative mx-auto w-fit">
          <div className="pdf-page">
            <canvas ref={canvasRef} className="block rounded-[6px]" />
            <div ref={textLayerRef} className="pdf-text-layer" />
          </div>
          {selection ? (
            <JargonOverlay
              key={`${selection.selection.text}|${language}|${selection.pageUrl}`}
              selection={selection.selection}
              frame={selection.frame}
              language={language}
              pageUrl={selection.pageUrl}
              onClose={clearSelection}
            />
          ) : null}
        </div>

        {status !== "ready" || rendering ? (
          <p className="absolute inset-x-0 top-1/2 text-center text-sm text-muted" role="status">
            {status === "error" ? error : status === "loading" ? "Opening the document…" : "Drawing the page…"}
          </p>
        ) : null}
      </div>

      {status === "error" ? <p className="text-sm text-error">{error}</p> : null}
    </section>
  );
}

function FilePicker({ onPick }: { onPick: (file: File, bytes: ArrayBuffer) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Open a PDF from your device"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file, await file.arrayBuffer());
        }}
      />
      <Button size="sm" onClick={() => inputRef.current?.click()}>
        Open a PDF from your device
      </Button>
    </>
  );
}

/** The title the document declares, used only as a form-number hint. */
async function documentTitle(doc: PDFDocumentProxy): Promise<string | undefined> {
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    return typeof info?.Title === "string" ? info.Title : undefined;
  } catch {
    return undefined;
  }
}

/** pdf.js throws this when a render is superseded by the next one — not an error. */
function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException";
}

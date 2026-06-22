import { useEffect, useMemo, useState } from "react";
import { categorizeWithContent, codeLanguage, type FileCategory } from "../../utils/file-type.js";
import { CodeEditor } from "../CodeEditor.js";
import { MarkdownSummary } from "../tasks/TaskDetail/MarkdownSummary.js";

export interface FileViewerProps {
  relPath: string;
  fqn: string;
  fetchFile: (relPath: string) => Promise<ArrayBuffer>;
}

export function FileViewer({ relPath, fqn, fetchFile }: FileViewerProps) {
  const [content, setContent] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    fetchFile(relPath)
      .then((buf) => {
        if (!cancelled) setContent(buf);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relPath, fetchFile]);

  if (loading) return <div className="file-viewer__loading">Loading…</div>;
  if (error) return <div className="file-viewer__error">⚠ {error}</div>;
  if (!content) return null;

  const category = categorizeWithContent(relPath, content);
  return <RenderContent relPath={relPath} content={content} category={category} />;
}

interface RenderContentProps {
  relPath: string;
  content: ArrayBuffer;
  category: FileCategory;
}

function RenderContent({ relPath, content, category }: RenderContentProps) {
  const text = useMemo(() => {
    if (category === "binary" || category === "image") return "";
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      return "";
    }
  }, [content, category]);

  switch (category) {
    case "markdown":
      return (
        <div className="file-viewer__markdown">
          <MarkdownSummary source={text} />
        </div>
      );

    case "code": {
      const lang = codeLanguage(relPath);
      if (lang) {
        return (
          <div className="file-viewer__code">
            <CodeEditor value={text} onChange={() => {}} language={lang} disabled height="100%" />
          </div>
        );
      }
      return <pre className="file-viewer__pre">{text}</pre>;
    }

    case "image": {
      const blob = new Blob([content]);
      const url = URL.createObjectURL(blob);
      return (
        <div className="file-viewer__image">
          <img src={url} alt={relPath} onLoad={() => URL.revokeObjectURL(url)} />
        </div>
      );
    }

    case "binary":
      return <BinaryPlaceholder relPath={relPath} size={content.byteLength} content={content} />;

    case "plain":
    default:
      return <pre className="file-viewer__pre">{text}</pre>;
  }
}

function BinaryPlaceholder({
  relPath,
  size,
  content,
}: {
  relPath: string;
  size: number;
  content: ArrayBuffer;
}) {
  const handleDownload = () => {
    const blob = new Blob([content]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = relPath.split("/").pop() ?? "file";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="file-viewer__binary">
      <p>Binary file · {formatSize(size)}</p>
      <button type="button" className="btn btn--ghost" onClick={handleDownload}>
        Download
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

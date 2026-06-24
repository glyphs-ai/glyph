import { useEffect, useRef, useState } from "react";
import type { SessionView } from "../../api";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { formatRelative } from "../../utils/time";
import { ChevronDownIcon, CopyIcon, GlobeIcon, PlayIcon, RefreshIcon, TrashIcon } from "../Icons";

interface ListItemProps {
  session: SessionView;
  launching: boolean;
  preselected?: boolean;
  onPreselectConsumed?: () => void;
  onLaunch: (opts: { remote?: boolean }) => void;
  onDelete: () => void;
}

/**
 * One row of the sessions list. Two-row layout:
 *
 *   row 1: id · agent chip · runtime chip · — spacer — · action buttons
 *   row 2: activity preview · separator · "20m ago" (muted)
 *
 * Mirrors the Tasks list's `.task-list__item` shape so the two
 * primary "running entity" pages read consistently.
 */
export function SessionListItem({
  session,
  launching,
  preselected,
  onPreselectConsumed,
  onLaunch,
  onDelete,
}: ListItemProps) {
  const hasHistory = session.runtimeSessionId !== null && session.lastActiveAt !== null;
  const verb = hasHistory ? "Resume" : "Launch";
  // Default the primary action to whatever the user picked last for
  // this session, so a "remote-mostly" session keeps offering remote
  // as one click. Falls back to local on first launch (the safe and
  // historically conventional choice).
  const defaultMode: "local" | "remote" = session.lastLaunchMode ?? "local";

  // Pre-selection from the Overview tab: scroll into view once, mark
  // the row, then tell the parent to drop the flag so subsequent
  // re-renders don't keep re-firing the effect.
  const rowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!preselected) return;
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    onPreselectConsumed?.();
  }, [preselected, onPreselectConsumed]);

  return (
    <li
      ref={rowRef}
      className={`session-list__item${preselected ? " session-list__item--preselected" : ""}`}
    >
      <div className="session-list__head">
        <div className="session-list__headline" title={`Agent: ${session.agent}`}>
          {session.agent}
        </div>
        <div className="session-list__actions">
          <ResumeSplitButton
            verb={verb}
            launching={launching}
            defaultMode={defaultMode}
            onLaunch={onLaunch}
          />
          <CopyPathButton path={session.workdir} />
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title="Delete session"
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="session-list__activity">
        <SessionActivity session={session} />
      </div>
      {/* Combined footer: runtime + id on one muted line, matching the
          Tasks-list pattern. Avoids the previous dedicated-row-per-
          field layout that wasted vertical space and gave secondary
          metadata (runtime) the same visual weight as primary
          metadata (the activity preview). */}
      <div className="session-list__meta muted">
        <span title={`Runtime: ${session.runtime}`}>{session.runtime}</span>
        <span className="session-list__sep">·</span>
        <code className="session-list__id" title={session.workdir}>
          {session.id}
        </code>
      </div>
    </li>
  );
}

/**
 * GitHub-style "Code"-button split control: clicking the main face
 * launches in `defaultMode`; clicking the chevron opens a small menu
 * with both modes. The selected option becomes the next default
 * (persisted server-side as `session.lastLaunchMode`), so this
 * component only controls *immediate intent* — persistence is the
 * server's job.
 *
 * Why split-button (not two buttons): the visual layout of two equal
 * buttons gave both modes equal weight, but the dominant case is "I
 * just want to resume the same way I did last time". The split makes
 * primary one click while keeping the alternate mode visible (the
 * chevron is the affordance).
 */
function ResumeSplitButton({
  verb,
  launching,
  defaultMode,
  onLaunch,
}: {
  verb: string;
  launching: boolean;
  defaultMode: "local" | "remote";
  onLaunch: (opts: { remote?: boolean }) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — small ad-hoc dropdown without a
  // full popover library.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const fire = (mode: "local" | "remote") => {
    setMenuOpen(false);
    onLaunch(mode === "remote" ? { remote: true } : {});
  };

  const mainTitle = launching
    ? "Opening terminal…"
    : defaultMode === "remote"
      ? `${verb} in terminal with remote control (web & mobile)`
      : `${verb} in a new terminal`;

  return (
    <div className="resume-split" ref={wrapRef}>
      <button
        type="button"
        className="btn btn--primary resume-split__main"
        title={mainTitle}
        disabled={launching}
        onClick={() => fire(defaultMode)}
      >
        {launching ? (
          <RefreshIcon className="spin" />
        ) : defaultMode === "remote" ? (
          <GlobeIcon />
        ) : (
          <PlayIcon />
        )}
        <span>{defaultMode === "remote" ? `${verb} remote` : verb}</span>
      </button>
      <button
        type="button"
        className="btn btn--primary resume-split__chevron"
        title="Choose where to resume"
        aria-label="Resume options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={launching}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <ChevronDownIcon />
      </button>
      {menuOpen && (
        <div className="resume-split__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className={`resume-split__menu-item${
              defaultMode === "local" ? " resume-split__menu-item--active" : ""
            }`}
            onClick={() => fire("local")}
          >
            <PlayIcon />
            <div className="resume-split__menu-text">
              <span className="resume-split__menu-title">{verb} local only</span>
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            className={`resume-split__menu-item${
              defaultMode === "remote" ? " resume-split__menu-item--active" : ""
            }`}
            onClick={() => fire("remote")}
          >
            <GlobeIcon />
            <div className="resume-split__menu-text">
              <span className="resume-split__menu-title">{verb} with remote control</span>
              <span className="resume-split__menu-hint">Web &amp; mobile</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function SessionActivity({ session }: { session: SessionView }) {
  if (session.lastActiveAt === null) {
    return <span className="muted">never run</span>;
  }
  return (
    <span className="activity-cell" title={session.preview ?? undefined}>
      {session.preview && (
        <>
          {/* No JS-side length cap: CSS (overflow: hidden + text-overflow:
              ellipsis on .activity-cell__count) handles truncation based on
              the actual row width, so wide screens show more text instead
              of always cutting at 32 chars. The hover title still shows the
              full preview. */}
          <span className="activity-cell__count">{session.preview}</span>
          <span className="activity-cell__sep">·</span>
        </>
      )}
      <span className="muted">{formatRelative(session.lastActiveAt)}</span>
    </span>
  );
}

function CopyPathButton({ path }: { path: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      title={copied ? "Copied!" : `Copy workdir path (${path})`}
      aria-label="Copy workdir path"
      onClick={() => copy(path)}
    >
      <CopyIcon />
    </button>
  );
}

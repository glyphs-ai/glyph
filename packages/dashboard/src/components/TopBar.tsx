interface TopBarProps {
  title: string;
  /**
   * Breadcrumb chain rendered below the title. Each segment is plain text;
   * segments are never wrapped in <Link>. When the chain is omitted or
   * empty, no breadcrumb row renders.
   */
  breadcrumb?: readonly string[];
  /**
   * Ref callback wired to the trailing actions container. Pages portal
   * their toolbars into it through `HeaderActionsContext` so the chrome
   * header doubles as the page action strip.
   */
  actionsRef?: (el: HTMLDivElement | null) => void;
}

/**
 * TopBar is the per-page heading. Workspace selection lives in the Sidebar
 * (Linear-style) so the user always sees which workspace is active right
 * next to the navigation that's scoped to it. The trailing `topbar__actions`
 * slot is a portal target — pages (e.g. Catalog) inject their primary
 * actions via `<HeaderActions>`.
 *
 * The breadcrumb is text only by design: clickable crumbs are explicitly
 * out of scope for this shell because navigation already lives in the
 * sidebar.
 */
export function TopBar({ title, breadcrumb, actionsRef }: TopBarProps) {
  const chain = breadcrumb && breadcrumb.length > 0 ? breadcrumb : null;
  return (
    <header className="topbar">
      <div>
        <h1 className="topbar__title">{title}</h1>
        {chain && <div className="topbar__crumb">{chain.join(" / ")}</div>}
      </div>
      <div className="topbar__spacer" />
      <div className="topbar__actions" ref={actionsRef} />
    </header>
  );
}

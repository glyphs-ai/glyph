import { useMemo, useState } from "react";

export interface FileTreeEntry {
  relPath: string;
  size: number;
}

interface TreeNode {
  name: string;
  relPath: string | null;
  children: TreeNode[];
  isDir: boolean;
}

function buildTree(files: FileTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", relPath: null, children: [], isDir: true };
  for (const f of files) {
    const parts = f.relPath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          relPath: isLast ? f.relPath : null,
          children: [],
          isDir: !isLast,
        };
        current.children.push(child);
      }
      if (isLast) {
        child.relPath = f.relPath;
        child.isDir = false;
      }
      current = child;
    }
  }
  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) {
    if (n.isDir) sortTree(n.children);
  }
}

export interface FileTreeProps {
  files: FileTreeEntry[];
  selected: string | null;
  anchor: string;
  onSelect: (relPath: string) => void;
}

export function FileTree({ files, selected, anchor, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return (
      <nav className="file-tree" aria-label="File tree">
        <p className="file-tree__empty">No files</p>
      </nav>
    );
  }

  return (
    <nav className="file-tree" aria-label="File tree">
      <div className="file-tree__list" role="listbox">
        {tree.map((node) => (
          <TreeNodeItem
            key={node.name}
            node={node}
            selected={selected}
            anchor={anchor}
            onSelect={onSelect}
            depth={0}
          />
        ))}
      </div>
    </nav>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  selected: string | null;
  anchor: string;
  onSelect: (relPath: string) => void;
  depth: number;
}

function TreeNodeItem({ node, selected, anchor, onSelect, depth }: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(true);

  if (node.isDir) {
    return (
      <div className="file-tree__dir">
        <button
          type="button"
          className="file-tree__dir-toggle"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          aria-expanded={expanded}
        >
          <span className="file-tree__icon" aria-hidden="true">
            {expanded ? "📂" : "📁"}
          </span>
          {node.name}
        </button>
        {expanded && (
          <div className="file-tree__list">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.name}
                node={child}
                selected={selected}
                anchor={anchor}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = node.relPath === selected;
  const isAnchor = node.relPath === anchor;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      className={`file-tree__file${isSelected ? " file-tree__file--selected" : ""}${isAnchor ? " file-tree__file--anchor" : ""}`}
      onClick={() => node.relPath && onSelect(node.relPath)}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      title={node.relPath ?? node.name}
    >
      <span className="file-tree__icon" aria-hidden="true">
        📄
      </span>
      {node.name}
      {isAnchor && <span className="file-tree__badge">entry</span>}
    </button>
  );
}

interface FrontmatterTableProps {
  data: Record<string, unknown>;
}

/**
 * Renders parsed YAML frontmatter as a structured key-value table,
 * matching GitHub's presentation style.
 */
export function FrontmatterTable({ data }: FrontmatterTableProps) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div className="frontmatter-table">
      <table>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th>{key}</th>
              <td>{renderValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="frontmatter-table__null">null</span>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return (
      <ul className="frontmatter-table__list">
        {value.map((item, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: frontmatter arrays are static parsed data
          <li key={idx}>{renderValue(item)}</li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <table className="frontmatter-table__nested">
        <tbody>
          {entries.map(([key, val]) => (
            <tr key={key}>
              <th>{key}</th>
              <td>{renderValue(val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return String(value);
}

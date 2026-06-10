import { useCallback } from "react";
import { useUrlSearchValue } from "./useUrlState";

/**
 * Selected task id, mirrored to the URL via `?taskId=` so refresh /
 * back-button / share-link all land the user on the same master-detail
 * row.
 */
export function useSelectedTask(): {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
} {
  const [urlValue, setUrlValue] = useUrlSearchValue("taskId", "");

  const selectedId = urlValue === "" ? null : urlValue;
  const setSelectedId = useCallback(
    (id: string | null) => {
      setUrlValue(id ?? "");
    },
    [setUrlValue],
  );

  return { selectedId, setSelectedId };
}

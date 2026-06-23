import { SearchIcon } from "../common/SearchIcon";
import {
  SCHEDULE_STATE_FILTERS,
  type ScheduleStateFilter,
  WORKFLOW_ACTIVITY_FILTERS,
  type WorkflowActivityFilter,
} from "./shared";

export interface SchedulesFiltersProps {
  searchDraft: string;
  onSearchDraftChange: (v: string) => void;
  stateFilter: ScheduleStateFilter;
  onStateFilterChange: (v: ScheduleStateFilter) => void;
  activityFilter: WorkflowActivityFilter;
  onActivityFilterChange: (v: WorkflowActivityFilter) => void;
  showActivityFilters: boolean;
}

export function SchedulesFilters({
  searchDraft,
  onSearchDraftChange,
  stateFilter,
  onStateFilterChange,
  activityFilter,
  onActivityFilterChange,
  showActivityFilters,
}: SchedulesFiltersProps) {
  return (
    <div className="task-filters">
      <div
        className="task-filters__row task-filters__row--compact"
        style={{ flexWrap: "wrap", gap: 14 }}
      >
        <div className="task-filters__search-wrap">
          <SearchIcon />
          <input
            id="schedule-name-filter"
            type="search"
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
            placeholder="Search by name…"
            className="input task-filters__search"
            aria-label="Search schedules by name"
          />
        </div>

        {/* Group label + chips into a single flex child so flex-wrap keeps
            them on the same line (or wraps them together as a unit). */}
        <div
          className="task-filters__group"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            State:
          </span>
          <div className="pills task-filters__pills" style={{ gap: 6 }}>
            {SCHEDULE_STATE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`pills__btn${stateFilter === filter.value ? " pills__btn--active" : ""}`}
                onClick={() => onStateFilterChange(filter.value)}
                aria-pressed={stateFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {showActivityFilters && (
          <div
            className="task-filters__group"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
              <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                Activity:
              </span>
              <div className="pills task-filters__pills" style={{ gap: 6 }}>
                {WORKFLOW_ACTIVITY_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`pills__btn${activityFilter === filter.value ? " pills__btn--active" : ""}`}
                    onClick={() => onActivityFilterChange(filter.value)}
                    aria-pressed={activityFilter === filter.value}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
          </div>
        )}
      </div>
    </div>
  );
}

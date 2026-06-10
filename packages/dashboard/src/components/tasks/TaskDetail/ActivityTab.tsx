import type { TaskActivity } from "../../../api";
import { ActivityView } from "../ActivityView";
import { StickToBottomScroll } from "../StickToBottomScroll";

export interface ActivityTabProps {
  taskId: string;
  activity: TaskActivity | null;
  activityError: string | null;
  onLoadOlder: () => Promise<void>;
}

/**
 * Activity tab — the full live-tailing activity stream with
 * stick-to-bottom + load-older-on-scroll-up behaviour.
 */
export function ActivityTab({ taskId, activity, activityError, onLoadOlder }: ActivityTabProps) {
  return (
    <StickToBottomScroll
      className="task-detail__body"
      resetKey={taskId}
      followKey={activity?.activity[activity.activity.length - 1]?.seq ?? 0}
      topAnchorKey={activity?.activity[0]?.seq ?? 0}
    >
      <ActivityView activity={activity} activityError={activityError} onLoadOlder={onLoadOlder} />
    </StickToBottomScroll>
  );
}

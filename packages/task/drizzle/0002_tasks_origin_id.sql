ALTER TABLE `tasks` ADD COLUMN `origin_id` text;
--> statement-breakpoint
UPDATE `tasks` SET `origin_id` = json_extract(`metadata`, '$.scheduleId')
  WHERE `origin` = 'schedule' AND json_extract(`metadata`, '$.scheduleId') IS NOT NULL;
--> statement-breakpoint
UPDATE `tasks` SET `origin_id` = json_extract(`metadata`, '$.workflowNodeId')
  WHERE `origin` = 'workflow' AND json_extract(`metadata`, '$.workflowNodeId') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `tasks_origin_pair_idx` ON `tasks` (`origin`, `origin_id`) WHERE `origin_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `_assert_tasks_origin_backfill` (`x`);
--> statement-breakpoint
CREATE TEMP TRIGGER `_assert_tasks_origin_backfill_trg` BEFORE INSERT ON `_assert_tasks_origin_backfill`
BEGIN
  SELECT RAISE(FAIL, 'tasks backfill incomplete')
  WHERE EXISTS (SELECT 1 FROM `tasks` WHERE `origin` NOT IN ('standalone') AND `origin_id` IS NULL);
END;
--> statement-breakpoint
INSERT INTO `_assert_tasks_origin_backfill` VALUES (1);
--> statement-breakpoint
DROP TRIGGER `_assert_tasks_origin_backfill_trg`;
--> statement-breakpoint
DROP TABLE `_assert_tasks_origin_backfill`;
--> statement-breakpoint
DROP INDEX IF EXISTS `tasks_schedule_id_idx`;

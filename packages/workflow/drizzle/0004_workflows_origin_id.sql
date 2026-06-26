ALTER TABLE `workflows` ADD COLUMN `origin_id` text;
--> statement-breakpoint
UPDATE `workflows` SET `origin_id` = json_extract(`metadata`, '$.scheduleId')
  WHERE `origin` = 'schedule' AND json_extract(`metadata`, '$.scheduleId') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `workflows_origin_pair_idx` ON `workflows` (`origin`, `origin_id`) WHERE `origin_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `_assert_workflows_origin_backfill` (`x`);
--> statement-breakpoint
CREATE TEMP TRIGGER `_assert_workflows_origin_backfill_trg` BEFORE INSERT ON `_assert_workflows_origin_backfill`
BEGIN
  SELECT RAISE(FAIL, 'workflows backfill incomplete: non-standalone row without origin_id')
  WHERE EXISTS (SELECT 1 FROM `workflows` WHERE `origin` != 'standalone' AND `origin_id` IS NULL);
END;
--> statement-breakpoint
INSERT INTO `_assert_workflows_origin_backfill` VALUES (1);
--> statement-breakpoint
DROP TRIGGER `_assert_workflows_origin_backfill_trg`;
--> statement-breakpoint
DROP TABLE `_assert_workflows_origin_backfill`;
--> statement-breakpoint
DROP INDEX IF EXISTS `workflows_schedule_id_idx`;

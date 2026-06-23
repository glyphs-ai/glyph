CREATE INDEX IF NOT EXISTS `workflows_schedule_id_idx`
  ON `workflows` (json_extract(`metadata`, '$.scheduleId'))
  WHERE `origin` = 'schedule';

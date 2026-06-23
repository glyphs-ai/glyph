ALTER TABLE `workflows` ADD `origin` text DEFAULT 'standalone' NOT NULL;--> statement-breakpoint
CREATE INDEX `workflows_origin_idx` ON `workflows` (`origin`);
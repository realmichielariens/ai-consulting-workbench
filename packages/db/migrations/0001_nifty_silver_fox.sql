CREATE TABLE `agenda_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`links` text NOT NULL,
	`resolution` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`run_id` text,
	`proposal_id` text,
	`asset` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread` ON `chat_messages` (`thread_id`,`at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`from_actor` text NOT NULL,
	`text` text NOT NULL,
	`item_id` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE INDEX `notifications_open` ON `notifications` (`dismissed_at`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`suggested_by` text,
	`request_id` text,
	`thread_id` text,
	`author` text NOT NULL,
	`status` text NOT NULL,
	`base_plan_version` integer NOT NULL,
	`rationale` text NOT NULL,
	`ops` text NOT NULL,
	`applied_plan_version` integer,
	`reject_reason` text,
	`superseded_by` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `proposals_status` ON `proposals` (`status`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`session_id` text,
	`last_seen_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `requests` ADD `routed_to` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `escalation` text;
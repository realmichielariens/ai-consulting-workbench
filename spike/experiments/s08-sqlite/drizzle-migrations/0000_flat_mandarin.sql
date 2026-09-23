CREATE TABLE `agenda_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`owner` text NOT NULL,
	`priority` integer NOT NULL,
	`human_rank` integer,
	`trigger` text,
	`claim_session` text,
	`claim_until` integer,
	`resolution` text
);
--> statement-breakpoint
CREATE TABLE `asset_versions` (
	`slot_ref` text NOT NULL,
	`major` integer NOT NULL,
	`minor` integer NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`at` integer NOT NULL,
	`note` text,
	`run_id` text,
	`path` text NOT NULL,
	PRIMARY KEY(`slot_ref`, `major`, `minor`)
);
--> statement-breakpoint
CREATE TABLE `consumptions` (
	`run_id` text NOT NULL,
	`slot_ref` text NOT NULL,
	`major` integer NOT NULL,
	`minor` integer NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`run_id`, `slot_ref`, `major`, `minor`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`from_actor` text NOT NULL,
	`to_actor` text NOT NULL,
	`item_id` text,
	`status` text NOT NULL,
	`payload` text,
	`response` text,
	`agenda_id` text,
	`thread_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`scope_key` text NOT NULL,
	`lease_holder` text,
	`lease_until` integer,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_scope_key_unique` ON `sessions` (`scope_key`);
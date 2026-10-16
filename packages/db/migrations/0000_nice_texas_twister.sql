CREATE TABLE `asset_versions` (
	`slot_ref` text NOT NULL,
	`major` integer NOT NULL,
	`minor` integer NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`at` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`run_id` text,
	`path` text NOT NULL,
	`format` text NOT NULL,
	PRIMARY KEY(`slot_ref`, `major`, `minor`)
);
--> statement-breakpoint
CREATE TABLE `consumptions` (
	`run_id` text NOT NULL,
	`slot_ref` text NOT NULL,
	`major` integer NOT NULL,
	`minor` integer NOT NULL,
	`mode` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `slot_ref`, `major`, `minor`, `mode`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `gate_steps` (
	`item_id` text NOT NULL,
	`round` integer NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`request_id` text,
	`asset_versions` text NOT NULL,
	`verdict` text,
	`by` text,
	`decision_id` text,
	`at` integer,
	PRIMARY KEY(`item_id`, `round`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `item_inputs` (
	`item_id` text NOT NULL,
	`slot_ref` text NOT NULL,
	`required` integer NOT NULL,
	`pin` text,
	PRIMARY KEY(`item_id`, `slot_ref`)
);
--> statement-breakpoint
CREATE INDEX `item_inputs_slot` ON `item_inputs` (`slot_ref`);--> statement-breakpoint
CREATE TABLE `item_outputs` (
	`item_id` text NOT NULL,
	`slot` text NOT NULL,
	`slot_ref` text NOT NULL,
	`format` text NOT NULL,
	`scope` text NOT NULL,
	`required` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`item_id`, `slot`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_outputs_slot_ref_unique` ON `item_outputs` (`slot_ref`);--> statement-breakpoint
CREATE TABLE `item_sequencing` (
	`item_id` text NOT NULL,
	`after_item_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `after_item_id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`parent` text,
	`ord` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`executor` text,
	`title` text NOT NULL,
	`status` text,
	`autostart` integer DEFAULT true NOT NULL,
	`gate` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`def_hash` text NOT NULL,
	`last_session_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_parent` ON `items` (`parent`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`from_actor` text NOT NULL,
	`to_actor` text NOT NULL,
	`item_id` text NOT NULL,
	`run_id` text,
	`status` text NOT NULL,
	`blocking` integer NOT NULL,
	`payload` text NOT NULL,
	`response` text,
	`agenda_id` text,
	`thread_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `requests_item` ON `requests` (`item_id`);--> statement-breakpoint
CREATE INDEX `requests_open` ON `requests` (`status`,`to_actor`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`session_id` text,
	`reason` text NOT NULL,
	`outcome` text,
	`runtime` text NOT NULL,
	`model` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`prompt_hash` text,
	`nudged` integer DEFAULT false NOT NULL,
	`denials` integer DEFAULT 0 NOT NULL,
	`error` text,
	`report` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `runs_item` ON `runs` (`item_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`holder` text,
	`session_id` text,
	`lease_until` integer,
	`pid` integer,
	`status` text DEFAULT 'idle' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_holder` ON `sessions` (`holder`);
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`name` text NOT NULL,
	`body` text,
	`size` integer NOT NULL,
	`created` integer NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_room` ON `items` (`room`);--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limits_expires` ON `limits` (`expires`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`expires` integer NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `rooms_expires` ON `rooms` (`expires`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`owner` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_room` ON `sessions` (`room`);
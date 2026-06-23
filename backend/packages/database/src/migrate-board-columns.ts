/**
 * Backward-compatible entry point.
 *
 * The old v2 script created/kept `To Do`, `Needs Fix`, `Testing`, and other
 * statuses that are no longer part of the Desarrollo board. Keep this file as
 * an alias so any existing command now runs the canonical 6-column workflow
 * migration instead of reintroducing obsolete columns.
 */
import "./migrate-rename-columns";

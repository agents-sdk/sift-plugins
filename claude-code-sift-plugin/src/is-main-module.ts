import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Guards the module-level entry call so tests can import hook modules
 * without dragging in stdin side effects. Callers must pass their own
 * import.meta.url — inside this shared module it would refer to the helper
 * itself. process.argv[1] keeps whatever path the spawner passed, so resolve
 * it to the realpath form import.meta.url always uses (macOS /tmp symlink
 * and friends).
 */
export function isMainModule(moduleUrl: string): boolean {
	try {
		return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

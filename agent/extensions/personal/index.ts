import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPiRules from "./pi-rules/index.ts";

export default function registerPersonalExtensions(pi: ExtensionAPI): void {
	registerPiRules(pi);
}

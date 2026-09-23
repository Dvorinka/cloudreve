import { requireLinux } from "@cloudreve/testkit/linux-docker";
import { pathToFileURL } from "node:url";

export { requireLinux } from "@cloudreve/testkit/linux-docker";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireLinux();
  console.log("Linux E2E runner confirmed.");
}

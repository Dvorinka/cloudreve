import type { Transport } from "@cloudreve/sdk/protocol";

export const transport: Transport = (url, init) => fetch(url, init);

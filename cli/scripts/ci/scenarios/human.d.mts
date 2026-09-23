export interface HumanResult {
  data?: unknown;
  stdout?: Buffer;
  stderr?: string;
  status?: number;
}

export type CommandCall = (
  path: string,
  args?: string[],
  options?: Record<string, unknown>,
) => Promise<HumanResult>;

export function humanRunner(context: { run: CommandCall }): CommandCall;

export function human(context: unknown): Promise<void>;

export function commands(options: {
  bin: string;
  binary?: boolean;
  temp: string;
  config: string;
  requiredCommands: string[];
  requiredVariants: { path: string; variant: string }[];
}): {
  run(
    path: string,
    args?: string[],
    options?: Record<string, unknown>,
  ): Promise<{ data: unknown; stdout: Buffer; stderr: string; status: number }>;
  prove(path: string, variant: string, detail: string): void;
  complete(): unknown;
  secret(...values: string[]): void;
  navigation(endpoint: string): void;
  stop(): void;
  safe(value: unknown): string;
  invocations: unknown[];
  proofs: unknown[];
  transcripts: unknown[];
};

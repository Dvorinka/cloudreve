export interface VaultOperation {
  service: string;
  key: string;
  value?: string | null;
}

export async function nativeOperation(
  input: VaultOperation,
  load = () => import("@napi-rs/keyring"),
): Promise<string | null> {
  const { Entry } = await load();
  const entry = new Entry(input.service, input.key);

  if (input.value === undefined) {
    try {
      return entry.getPassword();
    } catch (error) {
      if (error instanceof Error && /not found|no entry|NoEntry/i.test(error.message)) {
        return null;
      }

      throw error;
    }
  }

  if (input.value === null) {
    try {
      entry.deletePassword();
    } catch (error) {
      if (!(error instanceof Error) || !/not found|no entry|NoEntry/i.test(error.message)) {
        throw error;
      }
    }

    return null;
  }

  entry.setPassword(input.value);

  return null;
}

export async function serve(
  port: { postMessage(message: unknown): void },
  input: VaultOperation,
  load = () => import("@napi-rs/keyring"),
) {
  let bindingLoaded = false;

  try {
    const binding = await load();

    bindingLoaded = true;
    port.postMessage({ ok: true, value: await nativeOperation(input, async () => binding) });
  } catch {
    port.postMessage({ ok: false, bindingLoaded });
  }
}

/** Handle private IPC before the CLI parser runs; ordinary invocations cannot enter this mode. */
export function serveNativeVault(host = process): boolean {
  if (!host.send || host.argv[2] !== "--cloudreve-native-vault") {
    return false;
  }

  host.once("message", (input) => {
    void serve(
      { postMessage: (message) => host.send!(message as object) },
      input as VaultOperation,
    );
  });

  return true;
}

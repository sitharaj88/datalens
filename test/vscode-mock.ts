/**
 * Minimal stand-in for the `vscode` module so extension-host services can be
 * unit-tested under vitest (the real module is only available inside VS Code).
 * Only the surface area used by the services under test is implemented.
 */

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void {
    for (const l of this.listeners) {
      l(data);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

// Configuration is overridable per-test via __setConfig.
let configValues: Record<string, unknown> = {};
export function __setConfig(values: Record<string, unknown>): void {
  configValues = values;
}

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue: T): T =>
      (key in configValues ? (configValues[key] as T) : defaultValue),
  }),
};

// showInputBox is overridable per-test via __setInputBoxResult.
let inputBoxResult: string | undefined;
export function __setInputBoxResult(value: string | undefined): void {
  inputBoxResult = value;
}

export const window = {
  showInputBox: async () => inputBoxResult,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};

export default { EventEmitter, workspace, window };

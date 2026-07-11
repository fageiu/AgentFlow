declare const process: {
  cwd(): string;
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

declare const console: {
  error(...data: unknown[]): void;
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
};

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function renameSync(oldPath: string, newPath: string): void;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
}

declare module "node:assert/strict" {
  interface AssertStrict {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
  }

  const assert: AssertStrict;
  export default assert;
}

declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

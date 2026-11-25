// app.config.ts runs in Node (Expo CLI) and only needs fs.existsSync. The
// project's tsconfig deliberately leaves @types/node out (types: ["jest"]),
// so RN's timer and global types aren't overridden by Node's. This shim
// declares just that one function.
declare module 'fs' {
  export function existsSync(path: string): boolean;
}

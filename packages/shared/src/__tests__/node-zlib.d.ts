// The package has no Node types (it runs in browsers too); the icon tests
// hand the generator Node's zlib, as the deployer does.
declare module "node:zlib" {
  export function deflateSync(
    data: Uint8Array,
    options?: { level?: number },
  ): Uint8Array;
  export function inflateSync(
    data: Uint8Array,
    options?: { maxOutputLength?: number },
  ): Uint8Array;
}

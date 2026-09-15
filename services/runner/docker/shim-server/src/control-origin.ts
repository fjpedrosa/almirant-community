import { isIP } from "node:net";
import os from "node:os";

type InterfaceInventory = Record<string, readonly { address: string }[] | undefined>;

// Conservative inventory ceilings; exceeding them denies rather than truncates.
const MAX_INTERFACES = 256;
const MAX_INTERFACE_NAME = 256;
const MAX_ENTRIES = 4096;

const ownDataValue = (object: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError("Invalid inventory descriptor");
  }
  return descriptor.value;
};

// At most 45 IP characters, a '%' separator, and 64 ASCII zone characters.
const normalizeIpAddress = (input: unknown): string | null => {
  if (typeof input !== "string" || input.length === 0 || input.length > 110) return null;
  const separator = input.indexOf("%");
  let address = input;
  if (separator !== -1) {
    const zone = input.slice(separator + 1);
    if (zone.length === 0 || zone.length > 64 || /[^a-zA-Z0-9_.-]/.test(zone)) return null;
    address = input.slice(0, separator);
  }
  const family = isIP(address);
  if (family === 4) return separator === -1 ? address : null;
  if (family !== 6) return null;

  // Validate before URL canonicalization: never accept URL/hostname coercions.
  // Zones identify interfaces, not address bytes; strip them conservatively so
  // a different zone spelling cannot turn a local address into an external peer.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};

/** Direct socket peer classification only; not proxy, TLS, or destination authorization.
 * Discovery is lazy and injectable; no inventory is cached across decisions.
 */
export const isExternalControlOrigin = (
  peer: unknown,
  discover: () => InterfaceInventory = () => os.networkInterfaces(),
): boolean => {
  try {
    const remote = normalizeIpAddress(peer);
    if (remote === null || remote === "0.0.0.0" || remote === "::" || remote === "::1") return false;
    if (isIP(remote) === 4 && remote.startsWith("127.")) return false;

    const interfaces = discover();
    if (!interfaces || typeof interfaces !== "object" || Array.isArray(interfaces)) return false;
    // Include non-enumerable keys; never invoke inventory/array iterators or getters.
    // Reflect may execute Proxy traps: throws fail closed, but deceptive/non-returning
    // traps and the engine's own-key allocation cannot be bounded or detected here.
    const names = Reflect.ownKeys(interfaces);
    if (names.length === 0 || names.length > MAX_INTERFACES) return false;
    let count = 0;
    for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
      const name = names[nameIndex]!;
      if (typeof name !== "string" || name.length === 0 || name.length > MAX_INTERFACE_NAME) return false;
      const entries = ownDataValue(interfaces, name);
      if (entries === undefined) continue; // Node permits interfaces without entries.
      if (!Array.isArray(entries)) return false;
      const length = ownDataValue(entries, "length");
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > MAX_ENTRIES - count) return false;
      count += length;
      for (let index = 0; index < length; index++) {
        const entry = ownDataValue(entries, String(index));
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
        const address = normalizeIpAddress(ownDataValue(entry, "address"));
        if (address === null || address === remote) return false;
      }
    }
    return count > 0;
  } catch {
    // Incomplete discovery and unexpected failures must never disclose addresses.
    return false;
  }
};

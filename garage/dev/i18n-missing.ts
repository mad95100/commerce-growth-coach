// Prints the strings that still need an Arabic translation (JSON array).
import { AR } from "../src/lib/i18n-ar.ts";
import { collectKeys } from "../tests/unit/i18n-keys.ts";
const { keys } = collectKeys();
const missing = [...keys].filter((k) => !(k in AR)).sort();
console.log(JSON.stringify(missing, null, 0));
console.error(`${missing.length} missing / ${keys.size} total`);

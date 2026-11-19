import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const BUILTIN_INTENTS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'builtinIntents.json'), 'utf8')).intents;

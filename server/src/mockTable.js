import fs from 'node:fs';
export const MOCK_TABLE = JSON.parse(fs.readFileSync(new URL('./mockTable.json', import.meta.url), 'utf8'));

#!/usr/bin/env node
// ビルドの前に dist/ を消す。
// Windows では、前回の dist/ が残っているとビルドが途中で異常終了することがあるため（Vite 8.3.8 で確認）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
fs.rmSync(dist, { recursive: true, force: true });

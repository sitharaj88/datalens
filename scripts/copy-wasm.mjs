// Cross-platform copy of the sql.js WASM binary into dist/.
// Replaces the previous Unix-only `cp` invocation so the build works on Windows too.
import { copyFileSync, mkdirSync, existsSync } from 'fs';

const src = 'node_modules/sql.js/dist/sql-wasm.wasm';
const destDir = 'dist';

try {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  copyFileSync(src, `${destDir}/sql-wasm.wasm`);
} catch (err) {
  // Best-effort: in watch mode the file may not exist yet on the first pass.
  console.warn(`copy-wasm: ${err instanceof Error ? err.message : String(err)}`);
}

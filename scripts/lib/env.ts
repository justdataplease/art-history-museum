// Load .env.local (if present) into process.env before any script reads its
// settings (WIKI_USER_AGENT, FFMPEG, ...). Import this module first: values
// already set in the real environment win over the file.

import fs from "node:fs";
import path from "node:path";

const file = path.join(__dirname, "..", "..", ".env.local");
if (fs.existsSync(file)) process.loadEnvFile(file);

/**
 * `npm run db:migrate` — apply migrations to whichever database the env points at.
 * The app also migrates automatically on first DB use (see client.ts); this script
 * exists for CI and for warming a fresh PGlite directory.
 */
import { getDb } from "./client";

getDb()
  .then(() => {
    console.log("migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

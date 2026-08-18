import { closeDatabase, DATABASE_PATH, migrate, seed } from "../lib/talent-core.mjs";

const command = process.argv[2];

try {
  if (command === "migrate") {
    migrate();
    console.log(`Migrations applied: ${DATABASE_PATH}`);
  } else if (command === "seed") {
    const results = seed();
    console.log(`Seeded roster records: ${results.length}`);
  } else {
    console.error("Use: node scripts/run-core.mjs migrate|seed");
    process.exitCode = 1;
  }
} finally {
  closeDatabase();
}

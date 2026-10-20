// Reset the database to the sample dataset: `npm run seed`
import { openDb, DB_FILE } from "./db.js";
const dbx = await openDb({ seed: "force" });
dbx.save();
console.log("Database reset with sample data →", DB_FILE);
process.exit(0);

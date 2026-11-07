import { connectTestDatabase } from "../config/testDatabase.js";

// Top-level await makes a connection failure fail the test file once, before
// its individual tests (or any HTTP servers and database fixtures) are set up.
await connectTestDatabase();

// Suites call this after their own cleanup, keeping all database operations
// ahead of the shared connection shutdown.
export { disconnectTestDatabase } from "../config/testDatabase.js";

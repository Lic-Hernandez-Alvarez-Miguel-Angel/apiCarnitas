const { Pool } = require("pg");

console.log("DATABASE_URL existe:", !!process.env.DATABASE_URL);
console.log("NODE_ENV:", process.env.NODE_ENV);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
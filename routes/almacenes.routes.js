const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM almacenes
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener almacenes:", error);
    res.status(500).json({
      error: "Error al obtener almacenes",
    });
  }
});

module.exports = router;
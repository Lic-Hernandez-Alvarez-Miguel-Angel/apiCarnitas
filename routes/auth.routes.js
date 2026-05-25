const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/login", async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({
        error: "Correo y contraseña son obligatorios",
      });
    }

    const result = await pool.query(
      `
      SELECT id, nombre, correo, rol, activo
      FROM usuarios
      WHERE correo = $1
      AND password = $2
      AND activo = true
      LIMIT 1
      `,
      [correo, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Correo o contraseña incorrectos",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error login:", error);
    res.status(500).json({
      error: "Error al iniciar sesión",
    });
  }
});

module.exports = router;
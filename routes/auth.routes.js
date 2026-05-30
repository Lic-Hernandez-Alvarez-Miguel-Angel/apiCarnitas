const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/login", async (req, res) => {
  try {
    console.log("========== LOGIN RECIBIDO ==========");
    console.log("Body completo:", req.body);

    const { correo, password } = req.body;

    if (!correo || !password) {
      console.log("Faltan datos:", { correo, password });

      return res.status(400).json({
        error: "Correo y contraseña son obligatorios",
      });
    }

    const correoLimpio = String(correo).trim().toLowerCase();
    const passwordLimpio = String(password).trim();

    console.log("Correo limpio:", correoLimpio);
    console.log("Password recibido:", passwordLimpio);

    const result = await pool.query(
      `
      SELECT id, nombre, correo, rol, activo
      FROM usuarios
      WHERE LOWER(TRIM(correo)) = $1
      AND TRIM(password) = $2
      AND activo = true
      LIMIT 1
      `,
      [correoLimpio, passwordLimpio]
    );

    console.log("Usuarios encontrados:", result.rows.length);

    if (result.rows.length === 0) {
      console.log("Login incorrecto para:", correoLimpio);

      return res.status(401).json({
        error: "Correo o contraseña incorrectos",
      });
    }

    console.log("Login correcto:", result.rows[0]);

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Error login:", error);

    return res.status(500).json({
      error: "Error al iniciar sesión",
      detalle: error.message,
    });
  }
});

module.exports = router;
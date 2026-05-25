const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener todos los empleados activos
router.get("/empleados", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nombre, correo, rol, activo, fecha_creacion
      FROM usuarios
      WHERE rol = 'empleado'
      AND activo = true
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener empleados:", error);
    res.status(500).json({
      error: "Error al obtener empleados",
    });
  }
});

// Obtener todos los usuarios activos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nombre, correo, rol, activo, fecha_creacion
      FROM usuarios
      WHERE activo = true
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener usuarios:", error);
    res.status(500).json({
      error: "Error al obtener usuarios",
    });
  }
});

// Cambiar contraseña
router.put("/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "La nueva contraseña es obligatoria",
      });
    }

    const result = await pool.query(
      `
      UPDATE usuarios
      SET password = $1
      WHERE id = $2
      RETURNING id, nombre, correo, rol, activo
      `,
      [password, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Usuario no encontrado",
      });
    }

    res.json({
      mensaje: "Contraseña actualizada correctamente",
      usuario: result.rows[0],
    });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    res.status(500).json({
      error: "Error al cambiar contraseña",
    });
  }
});

// Eliminar empleado de forma lógica
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE usuarios
      SET activo = false
      WHERE id = $1
      RETURNING id, nombre, correo, rol, activo
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Usuario no encontrado",
      });
    }

    res.json({
      mensaje: "Empleado eliminado correctamente",
      usuario: result.rows[0],
    });
  } catch (error) {
    console.error("Error al eliminar empleado:", error);
    res.status(500).json({
      error: "Error al eliminar empleado",
    });
  }
});

module.exports = router;
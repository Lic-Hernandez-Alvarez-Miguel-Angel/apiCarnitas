const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener empleados con sus zonas asignadas
router.get("/empleados", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre AS empleado,
        u.correo,
        u.rol,
        epv.id AS asignacion_id,
        pv.id AS punto_venta_id,
        pv.nombre AS punto_venta,
        epv.activo,
        epv.fecha_asignacion
      FROM usuarios u
      LEFT JOIN empleados_puntos_venta epv
        ON epv.usuario_id = u.id
        AND epv.activo = true
      LEFT JOIN puntos_venta pv
        ON pv.id = epv.punto_venta_id
      WHERE u.rol = 'empleado'
      AND u.activo = true
      ORDER BY u.nombre ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener asignaciones:", error);
    res.status(500).json({
      error: "Error al obtener asignaciones",
    });
  }
});

// Obtener zona asignada por usuario
router.get("/usuario/:usuarioId", async (req, res) => {
  try {
    const { usuarioId } = req.params;

    const result = await pool.query(
      `
      SELECT
        epv.id AS asignacion_id,
        epv.usuario_id,
        u.nombre AS empleado,
        u.correo,
        epv.punto_venta_id,
        pv.nombre AS punto_venta,
        epv.activo,
        epv.fecha_asignacion
      FROM empleados_puntos_venta epv
      JOIN usuarios u ON u.id = epv.usuario_id
      JOIN puntos_venta pv ON pv.id = epv.punto_venta_id
      WHERE epv.usuario_id = $1
      AND epv.activo = true
      LIMIT 1
      `,
      [usuarioId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener zona del usuario:", error);
    res.status(500).json({
      error: "Error al obtener zona del usuario",
    });
  }
});

// Crear o cambiar asignación de empleado a punto de venta
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const { usuario_id, punto_venta_id } = req.body;

    if (!usuario_id || !punto_venta_id) {
      return res.status(400).json({
        error: "usuario_id y punto_venta_id son obligatorios",
      });
    }

    await client.query("BEGIN");

    const usuarioResult = await client.query(
      `
      SELECT id, nombre, correo, rol, activo
      FROM usuarios
      WHERE id = $1
      AND activo = true
      `,
      [usuario_id]
    );

    if (usuarioResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Empleado no encontrado",
      });
    }

    if (usuarioResult.rows[0].rol !== "empleado") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Solo se pueden asignar usuarios con rol empleado",
      });
    }

    const puntoResult = await client.query(
      `
      SELECT id, nombre, activo
      FROM puntos_venta
      WHERE id = $1
      AND activo = true
      `,
      [punto_venta_id]
    );

    if (puntoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Punto de venta no encontrado",
      });
    }

    // Desactivar asignaciones anteriores del empleado
    await client.query(
      `
      UPDATE empleados_puntos_venta
      SET activo = false
      WHERE usuario_id = $1
      AND activo = true
      `,
      [usuario_id]
    );

    // Crear nueva asignación
    const asignacionResult = await client.query(
      `
      INSERT INTO empleados_puntos_venta (
        usuario_id,
        punto_venta_id,
        activo
      )
      VALUES ($1, $2, true)
      RETURNING *
      `,
      [usuario_id, punto_venta_id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Empleado asignado correctamente",
      asignacion: asignacionResult.rows[0],
      empleado: usuarioResult.rows[0],
      punto_venta: puntoResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al asignar empleado:", error);
    res.status(500).json({
      error: "Error al asignar empleado",
    });
  } finally {
    client.release();
  }
});

// Quitar asignación
router.put("/:id/desactivar", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE empleados_puntos_venta
      SET activo = false
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Asignación no encontrada",
      });
    }

    res.json({
      mensaje: "Asignación desactivada correctamente",
      asignacion: result.rows[0],
    });
  } catch (error) {
    console.error("Error al desactivar asignación:", error);
    res.status(500).json({
      error: "Error al desactivar asignación",
    });
  }
});

module.exports = router;
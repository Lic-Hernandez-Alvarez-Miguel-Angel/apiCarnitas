const express = require("express");
const router = express.Router();
const pool = require("../db");

// =====================================================
// OBTENER CAJA ABIERTA
// =====================================================
router.get("/abierta", async (req, res) => {
  try {
    const { punto_venta_id } = req.query;

    const valores = [];
    const filtros = ["c.estado = 'abierta'", "c.activo = true"];

    if (punto_venta_id) {
      valores.push(punto_venta_id);
      filtros.push(`c.punto_venta_id = $${valores.length}`);
    }

    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.usuario_id,
        u.nombre AS usuario,
        c.punto_venta_id,
        pv.nombre AS punto_venta,
        c.monto_inicial,
        c.monto_final,
        c.observaciones,
        c.estado,
        c.fecha_apertura,
        c.fecha_cierre
      FROM caja c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      LEFT JOIN puntos_venta pv ON pv.id = c.punto_venta_id
      WHERE ${filtros.join(" AND ")}
      ORDER BY c.fecha_apertura DESC
      LIMIT 1
      `,
      valores
    );

    res.json(result.rows[0] || null);
  } catch (error) {
    console.error("Error al obtener caja abierta:", error);
    res.status(500).json({
      error: "Error al obtener caja abierta",
    });
  }
});

// =====================================================
// HISTORIAL DE CAJA
// =====================================================
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.usuario_id,
        u.nombre AS usuario,
        c.punto_venta_id,
        pv.nombre AS punto_venta,
        c.monto_inicial,
        c.monto_final,
        c.observaciones,
        c.estado,
        c.fecha_apertura,
        c.fecha_cierre
      FROM caja c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      LEFT JOIN puntos_venta pv ON pv.id = c.punto_venta_id
      WHERE c.activo = true
      ORDER BY c.fecha_apertura DESC
      LIMIT 100
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener historial de caja:", error);
    res.status(500).json({
      error: "Error al obtener historial de caja",
    });
  }
});

// =====================================================
// ABRIR CAJA
// =====================================================
router.post("/abrir", async (req, res) => {
  try {
    const {
      usuario_id,
      punto_venta_id,
      monto_inicial,
      observaciones = "",
    } = req.body;

    if (!usuario_id) {
      return res.status(400).json({
        error: "El usuario_id es obligatorio.",
      });
    }

    if (!monto_inicial || Number(monto_inicial) < 0) {
      return res.status(400).json({
        error: "El monto inicial debe ser válido.",
      });
    }

    const cajaAbierta = await pool.query(
      `
      SELECT id
      FROM caja
      WHERE estado = 'abierta'
      AND activo = true
      ${punto_venta_id ? "AND punto_venta_id = $1" : ""}
      LIMIT 1
      `,
      punto_venta_id ? [punto_venta_id] : []
    );

    if (cajaAbierta.rows.length > 0) {
      return res.status(400).json({
        error: "Ya existe una caja abierta.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO caja (
        usuario_id,
        punto_venta_id,
        monto_inicial,
        observaciones,
        estado
      )
      VALUES ($1, $2, $3, $4, 'abierta')
      RETURNING *
      `,
      [
        usuario_id,
        punto_venta_id || null,
        Number(monto_inicial),
        observaciones,
      ]
    );

    res.status(201).json({
      mensaje: "Caja abierta correctamente",
      caja: result.rows[0],
    });
  } catch (error) {
    console.error("Error al abrir caja:", error);
    res.status(500).json({
      error: "Error al abrir caja",
    });
  }
});

// =====================================================
// CERRAR CAJA
// =====================================================
router.put("/:id/cerrar", async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_final, observaciones = "" } = req.body;

    if (!monto_final || Number(monto_final) < 0) {
      return res.status(400).json({
        error: "El monto final debe ser válido.",
      });
    }

    const result = await pool.query(
      `
      UPDATE caja
      SET estado = 'cerrada',
          monto_final = $1,
          observaciones = $2,
          fecha_cierre = NOW()
      WHERE id = $3
      AND estado = 'abierta'
      RETURNING *
      `,
      [Number(monto_final), observaciones, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Caja no encontrada o ya cerrada.",
      });
    }

    res.json({
      mensaje: "Caja cerrada correctamente",
      caja: result.rows[0],
    });
  } catch (error) {
    console.error("Error al cerrar caja:", error);
    res.status(500).json({
      error: "Error al cerrar caja",
    });
  }
});

module.exports = router;
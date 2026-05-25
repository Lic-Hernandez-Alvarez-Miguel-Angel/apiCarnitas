const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener compras
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.producto_id,
        p.nombre AS producto,
        c.almacen_id,
        a.nombre AS almacen,
        c.usuario_id,
        u.nombre AS usuario,
        c.cantidad,
        c.unidad,
        c.precio_total,
        c.foto_ticket,
        c.fecha_compra
      FROM compras c
      JOIN productos p ON c.producto_id = p.id
      JOIN almacenes a ON c.almacen_id = a.id
      JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY c.fecha_compra DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener compras:", error);
    res.status(500).json({ error: "Error al obtener compras" });
  }
});

// Registrar compra y sumar al inventario
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      producto_id,
      almacen_id,
      usuario_id,
      cantidad,
      unidad,
      precio_total,
      foto_ticket,
    } = req.body;

    if (!producto_id || !almacen_id || !usuario_id || !cantidad || !unidad || !precio_total) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    await client.query("BEGIN");

    const compraResult = await client.query(
      `
      INSERT INTO compras (
        producto_id,
        almacen_id,
        usuario_id,
        cantidad,
        unidad,
        precio_total,
        foto_ticket
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        producto_id,
        almacen_id,
        usuario_id,
        cantidad,
        unidad,
        precio_total,
        foto_ticket || null,
      ]
    );

    await client.query(
      `
      INSERT INTO inventario (producto_id, almacen_id, cantidad)
      VALUES ($1, $2, $3)
      ON CONFLICT (producto_id, almacen_id)
      DO UPDATE SET
        cantidad = inventario.cantidad + EXCLUDED.cantidad,
        fecha_actualizacion = CURRENT_TIMESTAMP
      `,
      [producto_id, almacen_id, cantidad]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Compra registrada correctamente",
      compra: compraResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al registrar compra:", error);
    res.status(500).json({ error: "Error al registrar compra" });
  } finally {
    client.release();
  }
});

module.exports = router;
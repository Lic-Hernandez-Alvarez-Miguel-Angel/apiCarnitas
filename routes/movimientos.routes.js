const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener historial de movimientos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id,
        m.producto_id,
        p.nombre AS producto,
        m.almacen_origen_id,
        ao.nombre AS almacen_origen,
        m.almacen_destino_id,
        ad.nombre AS almacen_destino,
        m.usuario_id,
        u.nombre AS usuario,
        m.cantidad,
        m.unidad,
        m.fecha_movimiento
      FROM movimientos_inventario m
      JOIN productos p ON m.producto_id = p.id
      JOIN almacenes ao ON m.almacen_origen_id = ao.id
      JOIN almacenes ad ON m.almacen_destino_id = ad.id
      JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha_movimiento DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener movimientos:", error);
    res.status(500).json({
      error: "Error al obtener movimientos",
    });
  }
});

// Crear movimiento entre almacenes
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      producto_id,
      almacen_origen_id,
      almacen_destino_id,
      usuario_id,
      cantidad,
      unidad,
    } = req.body;

    if (
      !producto_id ||
      !almacen_origen_id ||
      !almacen_destino_id ||
      !usuario_id ||
      !cantidad ||
      !unidad
    ) {
      return res.status(400).json({
        error: "Faltan datos obligatorios",
      });
    }

    if (Number(almacen_origen_id) === Number(almacen_destino_id)) {
      return res.status(400).json({
        error: "El almacén origen y destino no pueden ser el mismo",
      });
    }

    await client.query("BEGIN");

    const inventarioOrigen = await client.query(
      `
      SELECT cantidad
      FROM inventario
      WHERE producto_id = $1
      AND almacen_id = $2
      FOR UPDATE
      `,
      [producto_id, almacen_origen_id]
    );

    if (inventarioOrigen.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "No existe inventario en el almacén origen",
      });
    }

    const cantidadDisponible = Number(inventarioOrigen.rows[0].cantidad);
    const cantidadMover = Number(cantidad);

    if (cantidadMover <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "La cantidad debe ser mayor a 0",
      });
    }

    if (cantidadMover > cantidadDisponible) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cantidad insuficiente. Disponible: ${cantidadDisponible}`,
      });
    }

    await client.query(
      `
      UPDATE inventario
      SET cantidad = cantidad - $1,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE producto_id = $2
      AND almacen_id = $3
      `,
      [cantidadMover, producto_id, almacen_origen_id]
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
      [producto_id, almacen_destino_id, cantidadMover]
    );

    const movimientoResult = await client.query(
      `
      INSERT INTO movimientos_inventario (
        producto_id,
        almacen_origen_id,
        almacen_destino_id,
        usuario_id,
        cantidad,
        unidad
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        producto_id,
        almacen_origen_id,
        almacen_destino_id,
        usuario_id,
        cantidadMover,
        unidad,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Movimiento registrado correctamente",
      movimiento: movimientoResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al registrar movimiento:", error);
    res.status(500).json({
      error: "Error al registrar movimiento",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
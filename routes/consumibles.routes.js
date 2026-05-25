const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener puntos de venta
router.get("/puntos-venta", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM puntos_venta
      WHERE activo = true
      ORDER BY nombre ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener puntos de venta:", error);
    res.status(500).json({ error: "Error al obtener puntos de venta" });
  }
});

// Obtener historial de salidas
router.get("/salidas", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cs.id,
        pv.nombre AS punto_venta,
        a.nombre AS almacen,
        p.nombre AS producto,
        u.nombre AS usuario,
        cs.cantidad,
        cs.unidad,
        cs.fecha_salida
      FROM consumibles_salida cs
      JOIN puntos_venta pv ON cs.punto_venta_id = pv.id
      JOIN almacenes a ON cs.almacen_id = a.id
      JOIN productos p ON cs.producto_id = p.id
      JOIN usuarios u ON cs.usuario_id = u.id
      ORDER BY cs.fecha_salida DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener salidas:", error);
    res.status(500).json({ error: "Error al obtener salidas" });
  }
});

// Sacar consumible del almacén hacia punto de venta
router.post("/salidas", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      punto_venta_id,
      almacen_id,
      producto_id,
      usuario_id,
      cantidad,
      unidad,
    } = req.body;

    if (
      !punto_venta_id ||
      !almacen_id ||
      !producto_id ||
      !usuario_id ||
      !cantidad ||
      !unidad
    ) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    await client.query("BEGIN");

    const inventarioResult = await client.query(
      `
      SELECT cantidad
      FROM inventario
      WHERE producto_id = $1
      AND almacen_id = $2
      FOR UPDATE
      `,
      [producto_id, almacen_id]
    );

    if (inventarioResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "No existe inventario para ese producto en ese almacén",
      });
    }

    const disponible = Number(inventarioResult.rows[0].cantidad);
    const cantidadSalida = Number(cantidad);

    if (cantidadSalida <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La cantidad debe ser mayor a 0" });
    }

    if (cantidadSalida > disponible) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cantidad insuficiente. Disponible: ${disponible}`,
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
      [cantidadSalida, producto_id, almacen_id]
    );

    const salidaResult = await client.query(
      `
      INSERT INTO consumibles_salida (
        punto_venta_id,
        almacen_id,
        producto_id,
        usuario_id,
        cantidad,
        unidad
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        punto_venta_id,
        almacen_id,
        producto_id,
        usuario_id,
        cantidadSalida,
        unidad,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Consumible registrado correctamente",
      salida: salidaResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al registrar salida:", error);
    res.status(500).json({ error: "Error al registrar salida" });
  } finally {
    client.release();
  }
});

// Registrar sobra y regresar al almacén
router.post("/sobras", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      punto_venta_id,
      almacen_id,
      producto_id,
      usuario_id,
      cantidad,
      unidad,
    } = req.body;

    if (
      !punto_venta_id ||
      !almacen_id ||
      !producto_id ||
      !usuario_id ||
      !cantidad ||
      !unidad
    ) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    const cantidadSobra = Number(cantidad);

    if (cantidadSobra <= 0) {
      return res.status(400).json({ error: "La cantidad debe ser mayor a 0" });
    }

    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO inventario (producto_id, almacen_id, cantidad)
      VALUES ($1, $2, $3)
      ON CONFLICT (producto_id, almacen_id)
      DO UPDATE SET
        cantidad = inventario.cantidad + EXCLUDED.cantidad,
        fecha_actualizacion = CURRENT_TIMESTAMP
      `,
      [producto_id, almacen_id, cantidadSobra]
    );

    const sobraResult = await client.query(
      `
      INSERT INTO consumibles_sobra (
        punto_venta_id,
        almacen_id,
        producto_id,
        usuario_id,
        cantidad,
        unidad
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        punto_venta_id,
        almacen_id,
        producto_id,
        usuario_id,
        cantidadSobra,
        unidad,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Sobra registrada correctamente",
      sobra: sobraResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al registrar sobra:", error);
    res.status(500).json({ error: "Error al registrar sobra" });
  } finally {
    client.release();
  }
});

module.exports = router;
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        i.id,
        p.id AS producto_id,
        p.nombre AS producto,
        p.categoria,
        a.id AS almacen_id,
        a.nombre AS almacen,
        i.cantidad,
        p.unidad_base
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      JOIN almacenes a ON i.almacen_id = a.id
      ORDER BY a.nombre, p.nombre
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener inventario:", error);
    res.status(500).json({
      error: "Error al obtener inventario",
    });
  }
});

router.get("/almacen/:almacenId", async (req, res) => {
  try {
    const { almacenId } = req.params;

    const result = await pool.query(
      `
      SELECT
        i.id,
        p.id AS producto_id,
        p.nombre AS producto,
        p.categoria,
        a.id AS almacen_id,
        a.nombre AS almacen,
        i.cantidad,
        p.unidad_base
      FROM inventario i
      JOIN productos p ON i.producto_id = p.id
      JOIN almacenes a ON i.almacen_id = a.id
      WHERE a.id = $1
      ORDER BY p.nombre
      `,
      [almacenId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener inventario por almacén:", error);
    res.status(500).json({
      error: "Error al obtener inventario por almacén",
    });
  }
});

module.exports = router;
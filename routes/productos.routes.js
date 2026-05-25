const express = require("express");
const router = express.Router();
const pool = require("../db");

function construirTipoVenta(producto) {
  const tipos = [];

  if (producto.precio_taco !== null) tipos.push("taco");
  if (producto.precio_medio !== null) tipos.push("medio");
  if (producto.precio_kilo !== null) tipos.push("kilo");
  if (producto.precio_gramo !== null) tipos.push("gramos");
  if (producto.precio_pieza !== null) tipos.push("pieza");

  return tipos;
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM productos
      WHERE activo = true
      ORDER BY id ASC
    `);

    const productos = result.rows.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      categoria: String(p.categoria || "").trim().toLowerCase(),
      unidad_base: p.unidad_base,

      precio_taco: p.precio_taco !== null ? Number(p.precio_taco) : null,
      precio_medio: p.precio_medio !== null ? Number(p.precio_medio) : null,
      precio_kilo: p.precio_kilo !== null ? Number(p.precio_kilo) : null,
      precio_gramo: p.precio_gramo !== null ? Number(p.precio_gramo) : null,
      precio_pieza: p.precio_pieza !== null ? Number(p.precio_pieza) : null,

      tipoVenta: construirTipoVenta(p),
    }));

    res.json(productos);
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({
      error: "Error al obtener productos",
    });
  }
});

module.exports = router;
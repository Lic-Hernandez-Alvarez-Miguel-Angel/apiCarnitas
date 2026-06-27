const express = require("express");
const router = express.Router();
const pool = require("../db");

/*
========================================
OBTENER COMPRAS
========================================
*/
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
    res.status(500).json({
      error: "Error al obtener compras",
    });
  }
});

/*
========================================
REGISTRAR COMPRA Y SUMAR AL INVENTARIO
========================================

Permite dos formas:

1. Producto existente:
{
  producto_id: 1,
  almacen_id: 1,
  usuario_id: 1,
  cantidad: 5,
  unidad: "kilos",
  precio_total: 350
}

2. Producto nuevo escrito manualmente:
{
  producto_nombre: "Servilletas",
  almacen_id: 1,
  usuario_id: 1,
  cantidad: 2,
  unidad: "paquetes",
  precio_total: 50
}

Si producto_nombre no existe, lo crea en productos.
Después registra la compra y suma al inventario.
========================================
*/
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      producto_id,
      producto_nombre,
      almacen_id,
      usuario_id,
      cantidad,
      unidad,
      precio_total,
      foto_ticket,
    } = req.body;

    if (!almacen_id || !usuario_id || !cantidad || !unidad || !precio_total) {
      return res.status(400).json({
        error: "Faltan datos obligatorios.",
      });
    }

    if (!producto_id && !producto_nombre) {
      return res.status(400).json({
        error: "Selecciona un producto o escribe uno nuevo.",
      });
    }

    const cantidadNumero = Number(cantidad);
    const precioTotalNumero = Number(precio_total);

    if (Number.isNaN(cantidadNumero) || cantidadNumero <= 0) {
      return res.status(400).json({
        error: "La cantidad debe ser mayor a 0.",
      });
    }

    if (Number.isNaN(precioTotalNumero) || precioTotalNumero <= 0) {
      return res.status(400).json({
        error: "El total pagado debe ser mayor a 0.",
      });
    }

    await client.query("BEGIN");

    let productoIdFinal = producto_id || null;

    /*
    ========================================
    SI NO VIENE producto_id, SE CREA O BUSCA
    EL PRODUCTO POR NOMBRE
    ========================================
    */
    if (!productoIdFinal && producto_nombre) {
      const nombreProductoLimpio = String(producto_nombre).trim();

      if (!nombreProductoLimpio) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "Escribe el nombre del producto nuevo.",
        });
      }

      const productoExistente = await client.query(
        `
        SELECT id
        FROM productos
        WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))
        LIMIT 1
        `,
        [nombreProductoLimpio]
      );

      if (productoExistente.rows.length > 0) {
        productoIdFinal = productoExistente.rows[0].id;
      } else {
        const nuevoProducto = await client.query(
          `
          INSERT INTO productos (
            nombre,
            categoria,
            unidad_base,
            activo
          )
          VALUES ($1, $2, $3, true)
          RETURNING id
          `,
          [
            nombreProductoLimpio,
            "compras",
            unidad,
          ]
        );

        productoIdFinal = nuevoProducto.rows[0].id;
      }
    }

    /*
    ========================================
    REGISTRAR COMPRA
    ========================================
    */
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
        productoIdFinal,
        almacen_id,
        usuario_id,
        cantidadNumero,
        unidad,
        precioTotalNumero,
        foto_ticket || null,
      ]
    );

    /*
    ========================================
    SUMAR AL INVENTARIO
    ========================================
    */
    await client.query(
      `
      INSERT INTO inventario (
        producto_id,
        almacen_id,
        cantidad
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (producto_id, almacen_id)
      DO UPDATE SET
        cantidad = inventario.cantidad + EXCLUDED.cantidad,
        fecha_actualizacion = CURRENT_TIMESTAMP
      `,
      [
        productoIdFinal,
        almacen_id,
        cantidadNumero,
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Compra registrada correctamente",
      compra: compraResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Error al registrar compra:", error);

    res.status(500).json({
      error: "Error al registrar compra",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
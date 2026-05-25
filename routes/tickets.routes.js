const express = require("express");
const router = express.Router();
const pool = require("../db");

function prepararItems(items) {
  return items.map((item) => ({
    producto_id: item.productoId || item.producto_id || null,
    nombre_producto: item.nombre || item.nombre_producto,
    cantidad: Number(item.cantidad) || 0,
    unidad: item.modoVenta || item.unidad || "",
    precio_unitario:
      Number(item.importe) && Number(item.cantidad)
        ? Number(item.importe) / Number(item.cantidad)
        : 0,
    subtotal: Number(item.importe) || 0,
  }));
}

// Obtener tickets
// Obtener tickets con filtros opcionales
router.get("/", async (req, res) => {
  try {
    const { usuario_id, punto_venta_id, rol } = req.query;

    const filtros = [];
    const valores = [];

    if (rol !== "jefe") {
      if (usuario_id) {
        valores.push(usuario_id);
        filtros.push(`t.usuario_id = $${valores.length}`);
      }

      if (punto_venta_id) {
        valores.push(punto_venta_id);
        filtros.push(`t.punto_venta_id = $${valores.length}`);
      }
    }

    const where =
      filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.folio,
        t.usuario_id,
        u.nombre AS usuario,
        t.almacen_id,
        a.nombre AS almacen,
        t.punto_venta_id,
        pv.nombre AS punto_venta,
        t.tipo_servicio,
        t.mesa,
        t.metodo_pago,
        t.monto_pagado,
        t.cambio,
        t.total,
        t.estado,
        t.fecha_venta
      FROM tickets t
      JOIN usuarios u ON t.usuario_id = u.id
      JOIN almacenes a ON t.almacen_id = a.id
      LEFT JOIN puntos_venta pv ON pv.id = t.punto_venta_id
      ${where}
      ORDER BY t.fecha_venta DESC
      `,
      valores
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener tickets:", error);
    res.status(500).json({
      error: "Error al obtener tickets",
    });
  }
});







// Buscar ticket abierto por mesa
router.get("/mesa/:mesa", async (req, res) => {
  try {
    const { mesa } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM tickets
      WHERE mesa = $1
      AND tipo_servicio = 'mesa'
      AND estado = 'abierto'
      LIMIT 1
      `,
      [mesa]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al buscar ticket por mesa:", error);
    res.status(500).json({
      error: "Error al buscar ticket por mesa",
    });
  }
});

// Obtener ticket por ID con detalle
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const ticketResult = await pool.query(
      `
      SELECT
        t.id,
        t.folio,
        t.usuario_id,
        u.nombre AS usuario,
        t.almacen_id,
        a.nombre AS almacen,
        t.tipo_servicio,
        t.mesa,
        t.metodo_pago,
        t.total,
        t.estado,
        t.fecha_venta
      FROM tickets t
      JOIN usuarios u ON t.usuario_id = u.id
      JOIN almacenes a ON t.almacen_id = a.id
      WHERE t.id = $1
      `,
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    const detalleResult = await pool.query(
      `
      SELECT
        id,
        ticket_id,
        producto_id,
        nombre_producto,
        cantidad,
        unidad,
        precio_unitario,
        subtotal,
        COALESCE(estado_item, 'pendiente') AS estado_item
      FROM ticket_detalle
      WHERE ticket_id = $1
      ORDER BY id ASC
      `,
      [id]
    );

    res.json({
      ...ticketResult.rows[0],
      items: detalleResult.rows,
    });
  } catch (error) {
    console.error("Error al obtener ticket:", error);
    res.status(500).json({
      error: "Error al obtener ticket",
    });
  }
});

// Crear ticket
router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
   const {
  tipoServicio,
  tipo_servicio,
  mesa,
  punto_venta_id,
  usuario_id,
  items,
} = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        error: "El ticket debe tener productos",
      });
    }
const tipoFinal = tipoServicio || tipo_servicio || "llevar";
const itemsPreparados = prepararItems(items);
const total = itemsPreparados.reduce((acc, item) => acc + item.subtotal, 0);

if (!usuario_id) {
  return res.status(400).json({
    error: "El usuario_id es obligatorio",
  });
}

if (!punto_venta_id) {
  return res.status(400).json({
    error: "El punto_venta_id es obligatorio",
  });
}

const usuarioId = usuario_id;
const almacenId = 1;
const folio = `TKT-${Date.now()}`;

    await client.query("BEGIN");

    const ticketResult = await client.query(
      `
     INSERT INTO tickets (
  folio,
  usuario_id,
  almacen_id,
  punto_venta_id,
  tipo_servicio,
  mesa,
  metodo_pago,
  total,
  estado
)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'abierto')
      RETURNING *
      `,
     [
  folio,
  usuarioId,
  almacenId,
  punto_venta_id,
  tipoFinal,
  tipoFinal === "mesa" ? mesa : "",
  "efectivo",
  total,
]
    );

    const ticket = ticketResult.rows[0];

    for (const item of itemsPreparados) {
      await client.query(
        `
        INSERT INTO ticket_detalle (
          ticket_id,
          producto_id,
          nombre_producto,
          cantidad,
          unidad,
          precio_unitario,
          subtotal,
          estado_item
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')
        `,
        [
          ticket.id,
          item.producto_id,
          item.nombre_producto,
          item.cantidad,
          item.unidad,
          item.precio_unitario,
          item.subtotal,
        ]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      mensaje: "Ticket creado correctamente",
      ...ticket,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al crear ticket:", error);
    res.status(500).json({
      error: "Error al crear ticket",
    });
  } finally {
    client.release();
  }
});

// Agregar items a mesa abierta
router.post("/mesa/:mesa/items", async (req, res) => {
  const client = await pool.connect();

  try {
    const { mesa } = req.params;
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        error: "No hay productos para agregar",
      });
    }

    await client.query("BEGIN");

    const ticketResult = await client.query(
      `
      SELECT *
      FROM tickets
      WHERE mesa = $1
      AND tipo_servicio = 'mesa'
      AND estado = 'abierto'
      LIMIT 1
      `,
      [mesa]
    );

    if (ticketResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "No hay ticket abierto para esta mesa",
      });
    }

    const ticket = ticketResult.rows[0];
    const itemsPreparados = prepararItems(items);
    const totalAgregar = itemsPreparados.reduce(
      (acc, item) => acc + item.subtotal,
      0
    );

    for (const item of itemsPreparados) {
      await client.query(
        `
        INSERT INTO ticket_detalle (
          ticket_id,
          producto_id,
          nombre_producto,
          cantidad,
          unidad,
          precio_unitario,
          subtotal,
          estado_item
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')
        `,
        [
          ticket.id,
          item.producto_id,
          item.nombre_producto,
          item.cantidad,
          item.unidad,
          item.precio_unitario,
          item.subtotal,
        ]
      );
    }

    const ticketActualizado = await client.query(
      `
      UPDATE tickets
      SET total = total + $1
      WHERE id = $2
      RETURNING *
      `,
      [totalAgregar, ticket.id]
    );

    await client.query("COMMIT");

    res.json({
      mensaje: "Productos agregados correctamente",
      ticket: ticketActualizado.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al agregar productos a mesa:", error);
    res.status(500).json({
      error: "Error al agregar productos a mesa",
    });
  } finally {
    client.release();
  }
});

// Agregar items a ticket por ID
router.post("/:id/items", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        error: "No hay productos para agregar",
      });
    }

    await client.query("BEGIN");

    const ticketResult = await client.query(
      `
      SELECT *
      FROM tickets
      WHERE id = $1
      AND estado = 'abierto'
      `,
      [id]
    );

    if (ticketResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Ticket no encontrado o cerrado",
      });
    }

    const itemsPreparados = prepararItems(items);
    const totalAgregar = itemsPreparados.reduce(
      (acc, item) => acc + item.subtotal,
      0
    );

    for (const item of itemsPreparados) {
      await client.query(
        `
        INSERT INTO ticket_detalle (
          ticket_id,
          producto_id,
          nombre_producto,
          cantidad,
          unidad,
          precio_unitario,
          subtotal,
          estado_item
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')
        `,
        [
          id,
          item.producto_id,
          item.nombre_producto,
          item.cantidad,
          item.unidad,
          item.precio_unitario,
          item.subtotal,
        ]
      );
    }

    const ticketActualizado = await client.query(
      `
      UPDATE tickets
      SET total = total + $1
      WHERE id = $2
      RETURNING *
      `,
      [totalAgregar, id]
    );

    await client.query("COMMIT");

    res.json({
      mensaje: "Productos agregados correctamente",
      ticket: ticketActualizado.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al agregar productos:", error);
    res.status(500).json({
      error: "Error al agregar productos",
    });
  } finally {
    client.release();
  }
});

// Marcar producto como entregado
router.put("/:ticketId/items/:itemId/entregar", async (req, res) => {
  try {
    const { ticketId, itemId } = req.params;

    const result = await pool.query(
      `
      UPDATE ticket_detalle
      SET estado_item = 'entregado'
      WHERE id = $1
      AND ticket_id = $2
      RETURNING *
      `,
      [itemId, ticketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Producto no encontrado en el ticket",
      });
    }

    res.json({
      mensaje: "Producto marcado como entregado",
      item: result.rows[0],
    });
  } catch (error) {
    console.error("Error al marcar entregado:", error);
    res.status(500).json({
      error: "Error al marcar producto como entregado",
    });
  }
});

// Finalizar ticket
router.put("/:id/finalizar", async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_pagado, metodo_pago = "efectivo" } = req.body;

    const pendientesResult = await pool.query(
      `
      SELECT COUNT(*) AS pendientes
      FROM ticket_detalle
      WHERE ticket_id = $1
      AND COALESCE(estado_item, 'pendiente') = 'pendiente'
      `,
      [id]
    );

    const pendientes = Number(pendientesResult.rows[0].pendientes);

    if (pendientes > 0) {
      return res.status(400).json({
        error: "No puedes finalizar. Aún hay productos pendientes.",
      });
    }

    const ticketActual = await pool.query(
      `
      SELECT total
      FROM tickets
      WHERE id = $1
      `,
      [id]
    );

    if (ticketActual.rows.length === 0) {
      return res.status(404).json({
        error: "Ticket no encontrado",
      });
    }

    const total = Number(ticketActual.rows[0].total);
    const pagado = Number(monto_pagado);

    if (metodo_pago === "efectivo") {
      if (!monto_pagado || pagado < total) {
        return res.status(400).json({
          error: `El monto pagado debe ser igual o mayor al total: $${total.toFixed(2)}`,
        });
      }
    }

    const cambio = metodo_pago === "efectivo" ? pagado - total : 0;

    const result = await pool.query(
      `
      UPDATE tickets
      SET estado = 'cerrado',
          metodo_pago = $1,
          monto_pagado = $2,
          cambio = $3
      WHERE id = $4
      RETURNING *
      `,
      [
        metodo_pago,
        metodo_pago === "efectivo" ? pagado : total,
        cambio,
        id,
      ]
    );

    res.json({
      mensaje: "Ticket finalizado correctamente",
      ticket: result.rows[0],
    });
  } catch (error) {
    console.error("Error al finalizar ticket:", error);
    res.status(500).json({
      error: "Error al finalizar ticket",
    });
  }
});

module.exports = router;
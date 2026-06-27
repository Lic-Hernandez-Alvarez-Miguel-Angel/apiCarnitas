const express = require("express");
const router = express.Router();
const pool = require("../db");

/*
=====================================================
HELPERS
=====================================================
*/

function convertirNumero(valor) {
  const numero = Number(valor);
  return Number.isNaN(numero) ? 0 : numero;
}

async function obtenerCajaCompletaPorId(cajaId) {
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
      c.fecha_cierre,
      c.activo
    FROM caja c
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN puntos_venta pv ON pv.id = c.punto_venta_id
    WHERE c.id = $1
    AND c.activo = true
    LIMIT 1
    `,
    [cajaId]
  );

  return result.rows[0] || null;
}

async function calcularResumenCaja(caja) {
  const ventasResult = await pool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE 
          WHEN metodo_pago = 'efectivo' THEN total
          ELSE 0
        END
      ), 0) AS ventas_efectivo,

      COALESCE(SUM(
        CASE 
          WHEN metodo_pago = 'transferencia' THEN total
          ELSE 0
        END
      ), 0) AS ventas_transferencia,

      COALESCE(SUM(total), 0) AS ventas_totales,

      COUNT(*) AS total_tickets
    FROM tickets
    WHERE estado IN ('pendiente_confirmacion', 'cerrado')
    AND fecha_pago IS NOT NULL
    AND fecha_pago >= $1
    AND ($2::timestamp IS NULL OR fecha_pago <= $2)
    AND ($3::int IS NULL OR punto_venta_id = $3)
    `,
    [
      caja.fecha_apertura,
      caja.fecha_cierre || null,
      caja.punto_venta_id || null,
    ]
  );

  const gastosResult = await pool.query(
    `
    SELECT COALESCE(SUM(monto), 0) AS total_gastos
    FROM gastos_caja
    WHERE caja_id = $1
    AND activo = true
    `,
    [caja.id]
  );

  const transferenciasResult = await pool.query(
    `
    SELECT
      id,
      folio,
      total,
      metodo_pago,
      fecha_pago,
      comprobante_pago IS NOT NULL AS tiene_comprobante
    FROM tickets
    WHERE metodo_pago = 'transferencia'
    AND estado IN ('pendiente_confirmacion', 'cerrado')
    AND fecha_pago IS NOT NULL
    AND fecha_pago >= $1
    AND ($2::timestamp IS NULL OR fecha_pago <= $2)
    AND ($3::int IS NULL OR punto_venta_id = $3)
    ORDER BY fecha_pago DESC
    `,
    [
      caja.fecha_apertura,
      caja.fecha_cierre || null,
      caja.punto_venta_id || null,
    ]
  );

  const ventasEfectivo = convertirNumero(
    ventasResult.rows[0]?.ventas_efectivo
  );

  const ventasTransferencia = convertirNumero(
    ventasResult.rows[0]?.ventas_transferencia
  );

  const ventasTotales = convertirNumero(
    ventasResult.rows[0]?.ventas_totales
  );

  const totalTickets = convertirNumero(
    ventasResult.rows[0]?.total_tickets
  );

  const totalGastos = convertirNumero(
    gastosResult.rows[0]?.total_gastos
  );

  const montoInicial = convertirNumero(caja.monto_inicial);
  const montoFinal =
    caja.monto_final === null || caja.monto_final === undefined
      ? null
      : convertirNumero(caja.monto_final);

  const efectivoEsperado = montoInicial + ventasEfectivo - totalGastos;

  const diferencia =
    montoFinal === null ? null : montoFinal - efectivoEsperado;

  return {
    caja_id: caja.id,
    estado: caja.estado,
    punto_venta_id: caja.punto_venta_id,
    punto_venta: caja.punto_venta,
    monto_inicial: montoInicial,
    monto_final: montoFinal,
    ventas_efectivo: ventasEfectivo,
    ventas_transferencia: ventasTransferencia,
    ventas_totales: ventasTotales,
    total_tickets: totalTickets,
    total_gastos: totalGastos,
    efectivo_esperado: efectivoEsperado,
    diferencia,
    transferencias: transferenciasResult.rows,
    fecha_apertura: caja.fecha_apertura,
    fecha_cierre: caja.fecha_cierre,
  };
}

/*
=====================================================
OBTENER CAJA ABIERTA
=====================================================
*/
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

/*
=====================================================
HISTORIAL DE CAJA CON FILTROS
=====================================================

Ejemplos:
GET /api/caja
GET /api/caja?fecha_inicio=2026-06-27&fecha_fin=2026-06-27
GET /api/caja?punto_venta_id=1
GET /api/caja?fecha_inicio=2026-06-27&fecha_fin=2026-06-27&punto_venta_id=1
=====================================================
*/
router.get("/", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, punto_venta_id } = req.query;

    const valores = [];
    const filtros = ["c.activo = true"];

    if (fecha_inicio) {
      valores.push(fecha_inicio);
      filtros.push(`c.fecha_apertura::date >= $${valores.length}::date`);
    }

    if (fecha_fin) {
      valores.push(fecha_fin);
      filtros.push(`c.fecha_apertura::date <= $${valores.length}::date`);
    }

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
        c.fecha_cierre,

        COALESCE(ventas.ventas_efectivo, 0) AS ventas_efectivo,
        COALESCE(ventas.ventas_transferencia, 0) AS ventas_transferencia,
        COALESCE(ventas.ventas_totales, 0) AS ventas_totales,
        COALESCE(ventas.total_tickets, 0) AS total_tickets,
        COALESCE(gastos.total_gastos, 0) AS total_gastos,

        (
          COALESCE(c.monto_inicial, 0)
          + COALESCE(ventas.ventas_efectivo, 0)
          - COALESCE(gastos.total_gastos, 0)
        ) AS efectivo_esperado,

        CASE 
          WHEN c.monto_final IS NULL THEN NULL
          ELSE (
            COALESCE(c.monto_final, 0)
            - (
              COALESCE(c.monto_inicial, 0)
              + COALESCE(ventas.ventas_efectivo, 0)
              - COALESCE(gastos.total_gastos, 0)
            )
          )
        END AS diferencia

      FROM caja c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      LEFT JOIN puntos_venta pv ON pv.id = c.punto_venta_id

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(
            CASE 
              WHEN t.metodo_pago = 'efectivo' THEN t.total
              ELSE 0
            END
          ), 0) AS ventas_efectivo,

          COALESCE(SUM(
            CASE 
              WHEN t.metodo_pago = 'transferencia' THEN t.total
              ELSE 0
            END
          ), 0) AS ventas_transferencia,

          COALESCE(SUM(t.total), 0) AS ventas_totales,

          COUNT(*) AS total_tickets
        FROM tickets t
        WHERE t.estado IN ('pendiente_confirmacion', 'cerrado')
        AND t.fecha_pago IS NOT NULL
        AND t.fecha_pago >= c.fecha_apertura
        AND (c.fecha_cierre IS NULL OR t.fecha_pago <= c.fecha_cierre)
        AND (c.punto_venta_id IS NULL OR t.punto_venta_id = c.punto_venta_id)
      ) ventas ON true

      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(g.monto), 0) AS total_gastos
        FROM gastos_caja g
        WHERE g.caja_id = c.id
        AND g.activo = true
      ) gastos ON true

      WHERE ${filtros.join(" AND ")}
      ORDER BY c.fecha_apertura DESC
      LIMIT 150
      `,
      valores
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener historial de caja:", error);
    res.status(500).json({
      error: "Error al obtener historial de caja",
    });
  }
});

/*
=====================================================
ABRIR CAJA
=====================================================
*/
router.post("/abrir", async (req, res) => {
  try {
    const {
      usuario_id,
      punto_venta_id,
      monto_inicial,
      observaciones = "",
    } = req.body;

    const montoInicialNumero = Number(monto_inicial);

    if (!usuario_id) {
      return res.status(400).json({
        error: "El usuario_id es obligatorio.",
      });
    }

    if (Number.isNaN(montoInicialNumero) || montoInicialNumero < 0) {
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
        montoInicialNumero,
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

/*
=====================================================
CERRAR CAJA
=====================================================
*/
router.put("/:id/cerrar", async (req, res) => {
  try {
    const { id } = req.params;
    const { monto_final, observaciones = "" } = req.body;

    const montoFinalNumero = Number(monto_final);

    if (Number.isNaN(montoFinalNumero) || montoFinalNumero < 0) {
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
      [montoFinalNumero, observaciones, id]
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

/*
=====================================================
RESUMEN DE CAJA
=====================================================
Muestra:
- ventas efectivo
- transferencias
- gastos
- efectivo esperado
- diferencia si la caja ya está cerrada
=====================================================
*/
router.get("/resumen", async (req, res) => {
  try {
    const { caja_id } = req.query;

    let caja;

    if (caja_id) {
      caja = await obtenerCajaCompletaPorId(caja_id);
    } else {
      const cajaResult = await pool.query(
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
          c.fecha_cierre,
          c.activo
        FROM caja c
        LEFT JOIN usuarios u ON u.id = c.usuario_id
        LEFT JOIN puntos_venta pv ON pv.id = c.punto_venta_id
        WHERE c.estado = 'abierta'
        AND c.activo = true
        ORDER BY c.fecha_apertura DESC
        LIMIT 1
        `
      );

      caja = cajaResult.rows[0] || null;
    }

    if (!caja) {
      return res.status(404).json({
        error: caja_id ? "Caja no encontrada." : "No hay caja abierta.",
      });
    }

    const resumen = await calcularResumenCaja(caja);

    res.json(resumen);
  } catch (error) {
    console.error("Error al obtener resumen de caja:", error);
    res.status(500).json({
      error: "Error al obtener resumen de caja",
    });
  }
});

/*
=====================================================
DETALLE DE UNA CAJA
=====================================================

GET /api/caja/:id/detalle

Regresa:
- caja
- resumen
- tickets incluidos en esa caja
- productos vendidos
- gastos
=====================================================
*/
router.get("/:id/detalle", async (req, res) => {
  try {
    const { id } = req.params;

    const caja = await obtenerCajaCompletaPorId(id);

    if (!caja) {
      return res.status(404).json({
        error: "Caja no encontrada.",
      });
    }

    const resumen = await calcularResumenCaja(caja);

    const ticketsResult = await pool.query(
      `
      SELECT
        t.id,
        t.folio,
        t.usuario_id,
        u.nombre AS usuario,
        t.punto_venta_id,
        pv.nombre AS punto_venta,
        t.tipo_servicio,
        t.mesa,
        t.metodo_pago,
        t.monto_pagado,
        t.cambio,
        t.total,
        t.estado,
        t.fecha_pago,
        t.fecha_venta,
        t.comprobante_pago IS NOT NULL AS tiene_comprobante
      FROM tickets t
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      LEFT JOIN puntos_venta pv ON pv.id = t.punto_venta_id
      WHERE t.estado IN ('pendiente_confirmacion', 'cerrado')
      AND t.fecha_pago IS NOT NULL
      AND t.fecha_pago >= $1
      AND ($2::timestamp IS NULL OR t.fecha_pago <= $2)
      AND ($3::int IS NULL OR t.punto_venta_id = $3)
      ORDER BY t.fecha_pago DESC
      `,
      [
        caja.fecha_apertura,
        caja.fecha_cierre || null,
        caja.punto_venta_id || null,
      ]
    );

    const ticketIds = ticketsResult.rows.map((ticket) => ticket.id);

    let detallesPorTicket = [];

    if (ticketIds.length > 0) {
      const detallesResult = await pool.query(
        `
        SELECT
          td.id,
          td.ticket_id,
          td.producto_id,
          td.nombre_producto,
          td.cantidad,
          td.unidad,
          td.precio_unitario,
          td.subtotal,
          COALESCE(td.estado_item, 'pendiente') AS estado_item
        FROM ticket_detalle td
        WHERE td.ticket_id = ANY($1::int[])
        ORDER BY td.ticket_id ASC, td.id ASC
        `,
        [ticketIds]
      );

      detallesPorTicket = detallesResult.rows;
    }

    const tickets = ticketsResult.rows.map((ticket) => ({
      ...ticket,
      items: detallesPorTicket.filter(
        (detalle) => Number(detalle.ticket_id) === Number(ticket.id)
      ),
    }));

    const productosVendidosResult = await pool.query(
      `
      SELECT
        td.nombre_producto,
        td.unidad,
        COALESCE(SUM(td.cantidad), 0) AS cantidad_total,
        COALESCE(SUM(td.subtotal), 0) AS total_vendido,
        COUNT(*) AS veces_vendido
      FROM ticket_detalle td
      JOIN tickets t ON t.id = td.ticket_id
      WHERE t.estado IN ('pendiente_confirmacion', 'cerrado')
      AND t.fecha_pago IS NOT NULL
      AND t.fecha_pago >= $1
      AND ($2::timestamp IS NULL OR t.fecha_pago <= $2)
      AND ($3::int IS NULL OR t.punto_venta_id = $3)
      AND COALESCE(td.estado_item, 'pendiente') <> 'cancelado'
      GROUP BY td.nombre_producto, td.unidad
      ORDER BY total_vendido DESC, cantidad_total DESC
      `,
      [
        caja.fecha_apertura,
        caja.fecha_cierre || null,
        caja.punto_venta_id || null,
      ]
    );

    const gastosResult = await pool.query(
      `
      SELECT
        g.id,
        g.caja_id,
        g.usuario_id,
        u.nombre AS usuario,
        g.concepto,
        g.categoria,
        g.monto,
        g.observaciones,
        g.fecha_gasto
      FROM gastos_caja g
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.caja_id = $1
      AND g.activo = true
      ORDER BY g.fecha_gasto DESC
      `,
      [caja.id]
    );

    res.json({
      caja,
      resumen,
      tickets,
      productos_vendidos: productosVendidosResult.rows,
      gastos: gastosResult.rows,
    });
  } catch (error) {
    console.error("Error al obtener detalle de caja:", error);
    res.status(500).json({
      error: "Error al obtener detalle de caja",
    });
  }
});

/*
=====================================================
LISTAR GASTOS DE CAJA
=====================================================
*/
router.get("/gastos", async (req, res) => {
  try {
    const { caja_id } = req.query;

    if (!caja_id) {
      return res.status(400).json({
        error: "El caja_id es obligatorio.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        g.id,
        g.caja_id,
        g.usuario_id,
        u.nombre AS usuario,
        g.concepto,
        g.categoria,
        g.monto,
        g.observaciones,
        g.fecha_gasto
      FROM gastos_caja g
      LEFT JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.caja_id = $1
      AND g.activo = true
      ORDER BY g.fecha_gasto DESC
      `,
      [caja_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener gastos:", error);
    res.status(500).json({
      error: "Error al obtener gastos",
    });
  }
});

/*
=====================================================
REGISTRAR GASTO DE CAJA
=====================================================
*/
router.post("/gastos", async (req, res) => {
  try {
    const {
      caja_id,
      usuario_id,
      concepto,
      categoria = "personal",
      monto,
      observaciones = "",
    } = req.body;

    const montoNumero = Number(monto);

    if (!caja_id) {
      return res.status(400).json({
        error: "No se encontró la caja abierta.",
      });
    }

    if (!concepto || !String(concepto).trim()) {
      return res.status(400).json({
        error: "El concepto del gasto es obligatorio.",
      });
    }

    if (Number.isNaN(montoNumero) || montoNumero <= 0) {
      return res.status(400).json({
        error: "El monto del gasto debe ser mayor a 0.",
      });
    }

    const cajaAbierta = await pool.query(
      `
      SELECT id
      FROM caja
      WHERE id = $1
      AND estado = 'abierta'
      AND activo = true
      LIMIT 1
      `,
      [caja_id]
    );

    if (cajaAbierta.rows.length === 0) {
      return res.status(400).json({
        error: "Solo puedes registrar gastos en una caja abierta.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO gastos_caja (
        caja_id,
        usuario_id,
        concepto,
        categoria,
        monto,
        observaciones
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        caja_id,
        usuario_id || null,
        String(concepto).trim(),
        categoria || "personal",
        montoNumero,
        observaciones || "",
      ]
    );

    res.status(201).json({
      mensaje: "Gasto registrado correctamente",
      gasto: result.rows[0],
    });
  } catch (error) {
    console.error("Error al registrar gasto:", error);
    res.status(500).json({
      error: "Error al registrar gasto",
    });
  }
});

module.exports = router;

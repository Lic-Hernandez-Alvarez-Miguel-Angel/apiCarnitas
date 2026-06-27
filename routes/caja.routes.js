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
// =====================================================
// RESUMEN DE CAJA
// Muestra ventas efectivo, transferencias, gastos y efectivo esperado
// =====================================================
router.get("/resumen", async (req, res) => {
  try {
    const { caja_id } = req.query;

    let cajaResult;

    if (caja_id) {
      cajaResult = await pool.query(
        `
        SELECT *
        FROM caja
        WHERE id = $1
        AND activo = true
        LIMIT 1
        `,
        [caja_id]
      );
    } else {
      cajaResult = await pool.query(
        `
        SELECT *
        FROM caja
        WHERE estado = 'abierta'
        AND activo = true
        ORDER BY fecha_apertura DESC
        LIMIT 1
        `
      );
    }

    if (cajaResult.rows.length === 0) {
      return res.status(404).json({
        error: "No hay caja abierta.",
      });
    }

    const caja = cajaResult.rows[0];

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

        COALESCE(SUM(total), 0) AS ventas_totales
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

    const ventasEfectivo = Number(ventasResult.rows[0]?.ventas_efectivo || 0);
    const ventasTransferencia = Number(
      ventasResult.rows[0]?.ventas_transferencia || 0
    );
    const ventasTotales = Number(ventasResult.rows[0]?.ventas_totales || 0);
    const totalGastos = Number(gastosResult.rows[0]?.total_gastos || 0);
    const montoInicial = Number(caja.monto_inicial || 0);

    const efectivoEsperado = montoInicial + ventasEfectivo - totalGastos;

    res.json({
      caja_id: caja.id,
      estado: caja.estado,
      monto_inicial: montoInicial,
      ventas_efectivo: ventasEfectivo,
      ventas_transferencia: ventasTransferencia,
      ventas_totales: ventasTotales,
      total_gastos: totalGastos,
      efectivo_esperado: efectivoEsperado,
      transferencias: transferenciasResult.rows,
      fecha_apertura: caja.fecha_apertura,
      fecha_cierre: caja.fecha_cierre,
    });
  } catch (error) {
    console.error("Error al obtener resumen de caja:", error);
    res.status(500).json({
      error: "Error al obtener resumen de caja",
    });
  }
});

// =====================================================
// LISTAR GASTOS DE CAJA
// =====================================================
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

// =====================================================
// REGISTRAR GASTO DE CAJA
// =====================================================
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

    if (!monto || Number(monto) <= 0) {
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
        Number(monto),
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
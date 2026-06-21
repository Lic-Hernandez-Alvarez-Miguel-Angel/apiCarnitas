const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth.routes");
const almacenesRoutes = require("./routes/almacenes.routes");
const productosRoutes = require("./routes/productos.routes");
const inventarioRoutes = require("./routes/inventario.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const comprasRoutes = require("./routes/compras.routes");
const movimientosRoutes = require("./routes/movimientos.routes");
const ticketsRoutes = require("./routes/tickets.routes");
const consumiblesRoutes = require("./routes/consumibles.routes");
const asignacionesRoutes = require("./routes/asignaciones.routes");
const cajaRoutes = require("./routes/caja.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ mensaje: "API Carnitas funcionando correctamente" });
});

app.use("/api", authRoutes);
app.use("/api/almacenes", almacenesRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/compras", comprasRoutes);
app.use("/api/movimientos", movimientosRoutes);
app.use("/api/tickets", ticketsRoutes);
app.use("/api/consumibles", consumiblesRoutes);
app.use("/api/asignaciones", asignacionesRoutes);
app.use("/api/caja", cajaRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
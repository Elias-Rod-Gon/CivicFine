const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { requerirTurnoActivo } = require('./turnos');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

// ==========================================================================
// Middlewares (mismos que panel_autoridad.js)
// ==========================================================================
function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Sesión requerida.' });

  try {
    req.usuario = jwt.verify(token, SECRET_KEY);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

function requerirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    }
    next();
  };
}

async function municipioDe(usuarioId) {
  const { rows } = await pool.query(
    'SELECT municipio_id FROM usuario WHERE usuario_id = $1',
    [usuarioId]
  );
  return rows[0] ? rows[0].municipio_id : null;
}

// Valida fechas YYYY-MM-DD; si no vienen, usa los últimos 30 días
function rangoFechas(desde, hasta) {
  const fechaValida = f => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
  const hoy = new Date();
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const inicio = fechaValida(desde) ? desde : hace30.toISOString().slice(0, 10);
  const fin = fechaValida(hasta) ? hasta : hoy.toISOString().slice(0, 10);
  return { inicio, fin };
}

// ==========================================================================
// GET /api/estadisticas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve datos para el mapa de calor, horas pico y porcentaje de reportes reales
// ==========================================================================
router.get(
  '/',
  verificarToken,
  requerirRol('autoridad', 'admin'),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const municipioId = await municipioDe(req.usuario.id);
      const { inicio, fin } = rangoFechas(req.query.desde, req.query.hasta);

      // Puntos para el mapa de calor (solo reportes con coordenadas)
      const { rows: puntos } = await pool.query(
        `SELECT latitud::float8 AS lat, longitud::float8 AS lng, estado
        FROM reporte
        WHERE municipio_id = $1
        AND latitud IS NOT NULL AND longitud IS NOT NULL
        AND fecha_hora::date BETWEEN $2::date AND $3::date`,
        [municipioId, inicio, fin]
      );

      // Reportes por hora del día (0 a 23, hora de Ciudad de México)
      const { rows: porHora } = await pool.query(
        `SELECT EXTRACT(HOUR FROM fecha_hora AT TIME ZONE 'America/Mexico_City')::int AS hora,
                COUNT(*)::int AS total
        FROM reporte
        WHERE municipio_id = $1
        AND fecha_hora::date BETWEEN $2::date AND $3::date
        GROUP BY hora
        ORDER BY hora`,
        [municipioId, inicio, fin]
      );

      // Conteo por estado
      const { rows: porEstado } = await pool.query(
        `SELECT estado, COUNT(*)::int AS total
        FROM reporte
        WHERE municipio_id = $1
        AND fecha_hora::date BETWEEN $2::date AND $3::date
        GROUP BY estado`,
        [municipioId, inicio, fin]
      );

      // Top de direcciones con más reportes
      const { rows: topDirecciones } = await pool.query(
        `SELECT COALESCE(direccion, 'Sin dirección') AS direccion, COUNT(*)::int AS total
        FROM reporte
        WHERE municipio_id = $1
        AND fecha_hora::date BETWEEN $2::date AND $3::date
        GROUP BY direccion
        ORDER BY total DESC
        LIMIT 5`,
        [municipioId, inicio, fin]
      );

      // Totales y porcentaje de reportes reales
      // Reales = validado (multado). Desestimados = rechazado.
      // Pendientes y en revisión no entran al porcentaje.
      const conteo = { pendiente: 0, en_revision: 0, validado: 0, rechazado: 0 };
      porEstado.forEach(e => { conteo[e.estado] = e.total; });

      const total = Object.values(conteo).reduce((a, b) => a + b, 0);
      const cerrados = conteo.validado + conteo.rechazado;
      const porcentajeReales = cerrados > 0
        ? Number(((conteo.validado / cerrados) * 100).toFixed(1))
        : null;

      // Horas completas de 0 a 23, con 0 donde no hubo reportes
      const horas = Array.from({ length: 24 }, (_, h) => {
        const fila = porHora.find(r => r.hora === h);
        return { hora: h, total: fila ? fila.total : 0 };
      });

      res.json({
        rango: { desde: inicio, hasta: fin },
        total,
        conteo,
        porcentaje_reales: porcentajeReales,
        cerrados,
        por_hora: horas,
        top_direcciones: topDirecciones,
        puntos_mapa: puntos
      });
    } catch (err) {
      console.error('[ESTADISTICAS] error:', err);
      res.status(500).json({ error: 'No se pudieron cargar las estadísticas.' });
    }
  }
);

module.exports = router;

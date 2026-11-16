const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) throw new Error('Falta JWT_SECRET');

const ESTADOS_ACTIVOS = ['pendiente', 'en_revision'];
const MAPA_ESTADO = { revision: ['pendiente', 'en_revision'], multado: ['validado'], descartado: ['rechazado'] };
const clientesSSE = new Set();

function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : (req.path === '/stream' ? req.query.token : null);
  if (!token) return res.status(401).json({ error: 'Sesión requerida.' });
  try { req.usuario = jwt.verify(token, SECRET_KEY); next(); } catch (err) { res.status(401).json({ error: 'Sesión inválida.' }); }
}
function requerirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) return res.status(403).json({ error: 'No tienes permiso.' });
    next();
  };
}
function emitirCambio(detalle) { const linea = `event: cambio\ndata: ${JSON.stringify(detalle)}\n\n`; clientesSSE.forEach(c => c.write(linea)); }

async function conTransaccion(fn) {
  const cliente = await pool.connect();
  try { await cliente.query('BEGIN'); const resultado = await fn(cliente); await cliente.query('COMMIT'); return resultado; }
  catch (err) { await cliente.query('ROLLBACK').catch(() => {}); throw err; }
  finally { cliente.release(); }
}

async function municipioDe(usuarioId, rol) {
  const { rows } = await pool.query('SELECT municipio_id FROM usuario WHERE usuario_id = $1', [usuarioId]);
  if (rows[0] && rows[0].municipio_id) return rows[0].municipio_id;
  return rol === 'admin' ? 1 : null;
}

async function bloquearReporte(cliente, reporteId, municipioId, isAdmin = false) {
  const { rows } = await cliente.query(
    `SELECT reporte_id AS id, estado, asignado_a, asignado_en, municipio_id, tipo_infraccion_id FROM reporte WHERE reporte_id = $1 FOR UPDATE`,
    [reporteId]
  );
  const r = rows[0];
  if (!r) return null;
  if (!isAdmin && r.municipio_id !== municipioId) return null;
  return r;
}

async function obtenerAutoridadValida(cliente, usuarioId, isAdmin) {
  if (!isAdmin) return usuarioId;
  try {
    const { rows } = await cliente.query('SELECT usuario_id FROM autoridad LIMIT 1');
    if (rows.length > 0) return rows[0].usuario_id;
  } catch (e) {}
  return usuarioId;
}

async function registrarSeguimiento(cliente, reporteId, autoridadId, anterior, nuevo, comentario) {
  try {
    await cliente.query(
      `INSERT INTO seguimiento_reporte (reporte_id, autoridad_id, estado_anterior, estado_nuevo, comentario) VALUES ($1, $2, $3, $4, $5)`,
      [reporteId, autoridadId, anterior, nuevo, comentario || null]
    );
  } catch (err) { console.log('⚠️ Aviso: No se guardó historial.', err.message); }
}

router.get('/reportes', verificarToken, requerirRol('autoridad', 'admin'), async (req, res) => {
  try {
    const isAdmin = req.usuario.rol === 'admin';
    const municipioId = await municipioDe(req.usuario.id, req.usuario.rol);
    const { estado, tipo, desde, q } = req.query;
    const estados = MAPA_ESTADO[estado] || null;
    const folioNum = q && /^REP-\d{4}-\d+$/i.test(q) ? Number(q.split('-')[2]) : null;

    // AQUI AGREGAMOS r.reporte_id AS id
    const { rows } = await pool.query(
      `SELECT r.*, r.reporte_id AS id, t.nombre AS tipo_infraccion, t.monto_referencia, u.nombre AS operador_nombre
      FROM reporte r
      JOIN tipo_infraccion t ON t.tipo_infraccion_id = r.tipo_infraccion_id
      LEFT JOIN usuario u ON u.usuario_id = r.asignado_a
      WHERE ($1::int IS NULL OR r.municipio_id = $1)
      AND ($2::text[] IS NULL OR r.estado = ANY($2::text[]))
      AND ($3::text IS NULL OR t.nombre = $3) AND ($4::date IS NULL OR r.fecha_hora::date = $4::date)
      AND ($5::text IS NULL OR r.placa_detectada ILIKE '%' || $5 || '%' OR r.reporte_id = $6)
      ORDER BY r.fecha_hora DESC LIMIT 200`,
      [isAdmin ? null : municipioId, estados, tipo || null, desde || null, q || null, folioNum]
    );
    res.json({ reportes: rows });
  } catch (err) { console.error('[ERROR LISTA]', err); res.status(500).json({ error: 'No se pudieron cargar.' }); }
});

router.get('/resumen', verificarToken, requerirRol('autoridad', 'admin'), async (req, res) => {
  try {
    const isAdmin = req.usuario.rol === 'admin';
    const municipioId = await municipioDe(req.usuario.id, req.usuario.rol);
    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM reporte WHERE ($1::int IS NULL OR municipio_id = $1) AND fecha_hora::date = CURRENT_DATE) AS hoy,
        (SELECT COUNT(*)::int FROM reporte WHERE ($1::int IS NULL OR municipio_id = $1) AND estado = ANY($2::text[])) AS pendientes,
        (SELECT COUNT(*)::int FROM multa m JOIN reporte r ON r.reporte_id = m.reporte_id WHERE ($1::int IS NULL OR r.municipio_id = $1) AND m.fecha_emision > NOW() - INTERVAL '7 days') AS multados_semana,
        (SELECT COALESCE(SUM(m.monto), 0) FROM multa m JOIN reporte r ON r.reporte_id = m.reporte_id WHERE ($1::int IS NULL OR r.municipio_id = $1) AND m.fecha_emision > NOW() - INTERVAL '7 days') AS monto_semana,
        (SELECT COUNT(*)::int FROM seguimiento_reporte s JOIN reporte r ON r.reporte_id = s.reporte_id WHERE ($1::int IS NULL OR r.municipio_id = $1) AND s.estado_nuevo = 'rechazado' AND s.fecha > NOW() - INTERVAL '7 days') AS descartados_semana`,
      [isAdmin ? null : municipioId, ESTADOS_ACTIVOS]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'No se pudo cargar resumen.' }); }
});

router.get('/catalogos', verificarToken, requerirRol('autoridad', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT tipo_infraccion_id AS id, nombre FROM tipo_infraccion ORDER BY nombre');
    res.json({ tipos: rows });
  } catch (err) { res.status(500).json({ error: 'Error catálogos' }); }
});

router.post('/reportes/:id/dictamen', verificarToken, requerirRol('autoridad', 'admin'), async (req, res) => {
  const reporteId = Number(req.params.id);
  if (isNaN(reporteId)) return res.status(400).json({ error: 'ID inválido.' });

  const { resultado: dictamen, monto, comentario } = req.body;
  if (!['validado', 'rechazado'].includes(dictamen)) return res.status(400).json({ error: 'Resultado no válido.' });
  const montoNum = dictamen === 'validado' ? Number(monto) : null;
  if (dictamen === 'validado' && !(montoNum > 0)) return res.status(400).json({ error: 'Monto inválido.' });

  try {
    const isAdmin = req.usuario.rol === 'admin';
    const municipioId = await municipioDe(req.usuario.id, req.usuario.rol);

    const resultado = await conTransaccion(async (cliente) => {
      const r = await bloquearReporte(cliente, reporteId, municipioId, isAdmin);
      if (!r) return { status: 404, body: { error: 'No encontrado.' } };
      if (!ESTADOS_ACTIVOS.includes(r.estado)) return { status: 409, body: { error: 'Ya dictaminado.' } };

      const autoridadValida = await obtenerAutoridadValida(cliente, req.usuario.id, isAdmin);

      if (dictamen === 'validado') {
        await cliente.query(
          `INSERT INTO multa (reporte_id, autoridad_id, tipo_infraccion_id, monto, estado_pago) VALUES ($1, $2, $3, $4, 'pendiente')`,
          [reporteId, autoridadValida, r.tipo_infraccion_id, montoNum]
        );
      }

      await cliente.query('UPDATE reporte SET estado = $2 WHERE reporte_id = $1', [reporteId, dictamen]);
      await registrarSeguimiento(cliente, reporteId, autoridadValida, r.estado, dictamen, comentario || 'Dictamen');
      return { status: 200, body: { mensaje: 'Dictaminado.' } };
    });

    if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'dictamen' });
    res.status(resultado.status).json(resultado.body);
  } catch (err) { console.error('[ERROR DICTAMEN]', err); res.status(500).json({ error: 'Error dictamen.' }); }
});

router.post('/reportes/:id/enviar-unidad', verificarToken, requerirRol('autoridad', 'admin'), async (req, res) => {
  const reporteId = Number(req.params.id);
  if (isNaN(reporteId)) return res.status(400).json({ error: 'ID inválido.' });

  const { tipo_unidad, prioridad, eta_minutos, comentario } = req.body;
  if (!['patrulla', 'grua', 'ambas'].includes(tipo_unidad)) return res.status(400).json({ error: 'Unidad inválida.' });

  try {
    const isAdmin = req.usuario.rol === 'admin';
    const municipioId = await municipioDe(req.usuario.id, req.usuario.rol);

    const resultado = await conTransaccion(async (cliente) => {
      const r = await bloquearReporte(cliente, reporteId, municipioId, isAdmin);
      if (!r) return { status: 404, body: { error: 'No encontrado.' } };
      if (!ESTADOS_ACTIVOS.includes(r.estado)) return { status: 409, body: { error: 'Ya dictaminado.' } };

      const autoridadValida = await obtenerAutoridadValida(cliente, req.usuario.id, isAdmin);
      const nota = `Unidad enviada: ${tipo_unidad.toUpperCase()} · Prioridad: ${prioridad} · ETA: ${eta_minutos} min. ${comentario || ''}`;
      await registrarSeguimiento(cliente, reporteId, autoridadValida, r.estado, 'en_revision', nota);
      return { status: 200, body: { mensaje: 'Unidad enviada.' } };
    });

    if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'unidad' });
    res.status(resultado.status).json(resultado.body);
  } catch (err) { console.error('[ERROR UNIDAD]', err); res.status(500).json({ error: 'Error unidad.' }); }
});

router.get('/stream', verificarToken, requerirRol('autoridad', 'admin'), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); res.write('retry: 5000\n\n');
  const latido = setInterval(() => res.write(': ping\n\n'), 25000);
  clientesSSE.add(res);
  req.on('close', () => { clearInterval(latido); clientesSSE.delete(res); });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { pool } = require('./db');
const { requerirTurnoActivo } = require('./turnos');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) throw new Error('Falta la variable de entorno JWT_SECRET');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const MINUTOS_RECLAMO = 30;
const ESTADOS_ACTIVOS = ['pendiente', 'en_revision'];
const ROLES_OPERATIVOS = ['autoridad', 'admin'];
const MAPA_ESTADO = {
  revision: ['pendiente', 'en_revision'],
  multado: ['validado'],
  descartado: ['rechazado']
};

const clientesSSE = new Set();

// ==========================================================================
// Utilidades
// ==========================================================================
async function urlFirmada(key) {
  if (!key) return null;
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

function emitirCambio(detalle) {
  const linea = `event: cambio\ndata: ${JSON.stringify(detalle)}\n\n`;
  clientesSSE.forEach(c => c.write(linea));
}

async function conTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

async function municipioDe(usuarioId) {
  const { rows } = await pool.query(
    'SELECT municipio_id FROM usuario WHERE usuario_id = $1',
    [usuarioId]
  );
  return rows[0] ? rows[0].municipio_id : null;
}

function reclamoVigente(r) {
  return r.asignado_a !== null
    && r.asignado_en !== null
    && ESTADOS_ACTIVOS.includes(r.estado)
    && Date.now() - new Date(r.asignado_en).getTime() < MINUTOS_RECLAMO * 60 * 1000;
}

async function bloquearReporte(cliente, reporteId, municipioId) {
  const { rows } = await cliente.query(
    `SELECT reporte_id AS id, estado, asignado_a, asignado_en, municipio_id, tipo_infraccion_id
     FROM reporte WHERE reporte_id = $1 FOR UPDATE`,
    [reporteId]
  );
  const r = rows[0];
  if (!r || r.municipio_id !== municipioId) return null;
  return r;
}

function registrarSeguimiento(cliente, reporteId, autoridadId, anterior, nuevo, comentario) {
  return cliente.query(
    `INSERT INTO seguimiento_reporte
       (reporte_id, autoridad_id, estado_anterior, estado_nuevo, comentario)
     VALUES ($1, $2, $3, $4, $5)`,
    [reporteId, autoridadId, anterior, nuevo, comentario || null]
  );
}

// ==========================================================================
// Middlewares
// ==========================================================================
function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ')
    ? encabezado.slice(7)
    : (req.path === '/stream' ? req.query.token : null);
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

// ==========================================================================
// 1. Lista de reportes (con URL firmada de la foto)
// ==========================================================================
router.get(
  '/reportes',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const municipioId = await municipioDe(req.usuario.id);
      const { estado, tipo, desde, q } = req.query;
      const estados = MAPA_ESTADO[estado] || null;
      const folioNum = q && /^REP-\d{4}-\d+$/i.test(q) ? Number(q.split('-')[2]) : null;

      const { rows } = await pool.query(
        `SELECT r.reporte_id AS id, r.fecha_hora, r.placa_detectada, r.estado,
                r.direccion, r.asignado_a, r.asignado_en,
                t.nombre AS tipo_infraccion, t.monto_referencia,
                u.nombre AS operador_nombre,
                (SELECT e.url_archivo FROM evidencia e
                  WHERE e.reporte_id = r.reporte_id
                  ORDER BY e.evidencia_id LIMIT 1) AS evidencia_key
         FROM reporte r
         JOIN tipo_infraccion t ON t.tipo_infraccion_id = r.tipo_infraccion_id
         LEFT JOIN usuario u ON u.usuario_id = r.asignado_a
         WHERE r.municipio_id = $1
           AND ($2::text[] IS NULL OR r.estado = ANY($2::text[]))
           AND ($3::text IS NULL OR t.nombre = $3)
           AND ($4::date IS NULL OR r.fecha_hora::date = $4::date)
           AND ($5::text IS NULL OR r.placa_detectada ILIKE '%' || $5 || '%' OR r.reporte_id = $6)
         ORDER BY r.fecha_hora DESC
         LIMIT 200`,
        [municipioId, estados, tipo || null, desde || null, q || null, folioNum]
      );

      const reportes = await Promise.all(rows.map(async r => {
        const vigente = reclamoVigente(r);
        return {
          id: r.id,
          fecha_hora: r.fecha_hora,
          placa_detectada: r.placa_detectada,
          estado: r.estado,
          direccion: r.direccion,
          tipo_infraccion: r.tipo_infraccion,
          monto_referencia: r.monto_referencia,
          evidencia_url: await urlFirmada(r.evidencia_key),
          reclamo_vigente: vigente,
          reclamado_por_mi: vigente && r.asignado_a === req.usuario.id,
          operador_nombre: vigente ? r.operador_nombre : null
        };
      }));

      res.json({ reportes });
    } catch (err) {
      console.error('[PANEL] error al listar:', err);
      res.status(500).json({ error: 'No se pudieron cargar los reportes.' });
    }
  }
);

// ==========================================================================
// 2. Resumen
// ==========================================================================
router.get(
  '/resumen',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const municipioId = await municipioDe(req.usuario.id);
      const { rows } = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM reporte
             WHERE municipio_id = $1 AND fecha_hora::date = CURRENT_DATE) AS hoy,
           (SELECT COUNT(*)::int FROM reporte
             WHERE municipio_id = $1 AND estado = ANY($2::text[])) AS pendientes,
           (SELECT COUNT(*)::int FROM multa m
             JOIN reporte r ON r.reporte_id = m.reporte_id
             WHERE r.municipio_id = $1 AND m.fecha_emision > NOW() - INTERVAL '7 days') AS multados_semana,
           (SELECT COALESCE(SUM(m.monto), 0) FROM multa m
             JOIN reporte r ON r.reporte_id = m.reporte_id
             WHERE r.municipio_id = $1 AND m.fecha_emision > NOW() - INTERVAL '7 days') AS monto_semana,
           (SELECT COUNT(*)::int FROM seguimiento_reporte s
             JOIN reporte r ON r.reporte_id = s.reporte_id
             WHERE r.municipio_id = $1 AND s.estado_nuevo = 'rechazado'
               AND s.fecha > NOW() - INTERVAL '7 days') AS descartados_semana`,
        [municipioId, ESTADOS_ACTIVOS]
      );
      res.json(rows[0]);
    } catch (err) {
      console.error('[PANEL] error en resumen:', err);
      res.status(500).json({ error: 'No se pudo cargar el resumen.' });
    }
  }
);

// ==========================================================================
// 3. Catálogo de tipos
// ==========================================================================
router.get(
  '/catalogos',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT tipo_infraccion_id AS id, nombre FROM tipo_infraccion ORDER BY nombre'
      );
      res.json({ tipos: rows });
    } catch (err) {
      console.error('[PANEL] error en catálogos:', err);
      res.status(500).json({ error: 'No se pudieron cargar los catálogos.' });
    }
  }
);

// ==========================================================================
// 4. Detalle de un expediente
// ==========================================================================
router.get(
  '/reportes/:id',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const reporteId = Number(req.params.id);
      if (!Number.isInteger(reporteId) || reporteId <= 0) {
        return res.status(400).json({ error: 'Id de reporte no válido.' });
      }
      const municipioId = await municipioDe(req.usuario.id);

      const { rows } = await pool.query(
        `SELECT r.reporte_id AS id, r.fecha_hora, r.latitud, r.longitud, r.direccion,
                r.descripcion, r.placa_detectada, r.estado, r.asignado_a, r.asignado_en,
                t.nombre AS tipo_infraccion, t.monto_referencia,
                c.nombre AS ciudadano_nombre, c.apellido AS ciudadano_apellido,
                op.nombre AS operador_nombre,
                (SELECT e.url_archivo FROM evidencia e
                  WHERE e.reporte_id = r.reporte_id
                  ORDER BY e.evidencia_id LIMIT 1) AS evidencia_key,
                (SELECT COUNT(*)::int FROM reporte p
                  WHERE p.placa_detectada = r.placa_detectada
                    AND p.reporte_id <> r.reporte_id) AS antecedentes
         FROM reporte r
         JOIN tipo_infraccion t ON t.tipo_infraccion_id = r.tipo_infraccion_id
         JOIN usuario c ON c.usuario_id = r.ciudadano_id
         LEFT JOIN usuario op ON op.usuario_id = r.asignado_a
         WHERE r.reporte_id = $1 AND r.municipio_id = $2`,
        [reporteId, municipioId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Reporte no encontrado en tu municipio.' });
      }

      const r = rows[0];
      const vigente = reclamoVigente(r);

      const { rows: multas } = await pool.query(
        `SELECT monto, estado_pago FROM multa WHERE reporte_id = $1 ORDER BY multa_id DESC LIMIT 1`,
        [reporteId]
      );
      const { rows: historial } = await pool.query(
        `SELECT s.fecha, s.estado_anterior, s.estado_nuevo, s.comentario,
                u.nombre AS autoridad_nombre
         FROM seguimiento_reporte s
         LEFT JOIN usuario u ON u.usuario_id = s.autoridad_id
         WHERE s.reporte_id = $1
         ORDER BY s.fecha`,
        [reporteId]
      );

      const evidencia_url = await urlFirmada(r.evidencia_key);
      const { evidencia_key, asignado_a, asignado_en, ...resto } = r;

      res.json({
        reporte: {
          ...resto,
          evidencia_url,
          reclamo_vigente: vigente,
          reclamado_por_mi: vigente && asignado_a === req.usuario.id,
          operador_nombre: vigente ? r.operador_nombre : null,
          multa: multas[0] || null
        },
        historial
      });
    } catch (err) {
      console.error('[EXPEDIENTE] error:', err);
      res.status(500).json({ error: 'No se pudo cargar el expediente.' });
    }
  }
);

// ==========================================================================
// 5. Reclamar
// ==========================================================================
router.post(
  '/reportes/:id/reclamar',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const reporteId = Number(req.params.id);
      const municipioId = await municipioDe(req.usuario.id);

      const resultado = await conTransaccion(async (cliente) => {
        const r = await bloquearReporte(cliente, reporteId, municipioId);
        if (!r) return { status: 404, body: { error: 'Reporte no encontrado.' } };
        if (!ESTADOS_ACTIVOS.includes(r.estado)) {
          return { status: 409, body: { error: 'Este reporte ya fue dictaminado.' } };
        }
        if (reclamoVigente(r) && r.asignado_a !== req.usuario.id) {
          return { status: 409, body: { error: 'Otro operador ya tiene este reporte.' } };
        }

        const { rows: mios } = await cliente.query(
          `SELECT reporte_id, estado, asignado_a, asignado_en
           FROM reporte
           WHERE asignado_a = $1 AND reporte_id <> $2 AND estado = ANY($3::text[])`,
          [req.usuario.id, reporteId, ESTADOS_ACTIVOS]
        );
        if (mios.some(reclamoVigente)) {
          return { status: 409, body: { error: 'Ya tienes otro reporte reclamado. Libéralo o dictamínalo primero.' } };
        }

        await cliente.query(
          `UPDATE reporte SET asignado_a = $1, asignado_en = NOW(), estado = 'en_revision' WHERE reporte_id = $2`,
          [req.usuario.id, reporteId]
        );
        await registrarSeguimiento(cliente, reporteId, req.usuario.id, r.estado, 'en_revision', 'Reclamado por operador');
        return { status: 200, body: { mensaje: 'Reporte reclamado.' } };
      });

      if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'reclamar' });
      res.status(resultado.status).json(resultado.body);
    } catch (err) {
      console.error('[PANEL] error al reclamar:', err);
      res.status(500).json({ error: 'No se pudo reclamar el reporte.' });
    }
  }
);

// ==========================================================================
// 6. Liberar
// ==========================================================================
router.post(
  '/reportes/:id/liberar',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const reporteId = Number(req.params.id);
      const municipioId = await municipioDe(req.usuario.id);

      const resultado = await conTransaccion(async (cliente) => {
        const r = await bloquearReporte(cliente, reporteId, municipioId);
        if (!r) return { status: 404, body: { error: 'Reporte no encontrado.' } };
        if (r.asignado_a !== req.usuario.id) {
          return { status: 409, body: { error: 'No tienes este reporte reclamado.' } };
        }
        const nuevoEstado = r.estado === 'en_revision' ? 'pendiente' : r.estado;
        await cliente.query(
          `UPDATE reporte SET asignado_a = NULL, asignado_en = NULL, estado = $2 WHERE reporte_id = $1`,
          [reporteId, nuevoEstado]
        );
        await registrarSeguimiento(cliente, reporteId, req.usuario.id, r.estado, nuevoEstado, 'Liberado por operador');
        return { status: 200, body: { mensaje: 'Reporte liberado.' } };
      });

      if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'liberar' });
      res.status(resultado.status).json(resultado.body);
    } catch (err) {
      console.error('[PANEL] error al liberar:', err);
      res.status(500).json({ error: 'No se pudo liberar el reporte.' });
    }
  }
);

// ==========================================================================
// 7. Enviar unidad (reclama el reporte para quien la envía)
// ==========================================================================
router.post(
  '/reportes/:id/enviar-unidad',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    try {
      const reporteId = Number(req.params.id);
      const { tipo_unidad, prioridad, eta_minutos, comentario } = req.body || {};
      const municipioId = await municipioDe(req.usuario.id);

      const resultado = await conTransaccion(async (cliente) => {
        const r = await bloquearReporte(cliente, reporteId, municipioId);
        if (!r) return { status: 404, body: { error: 'Reporte no encontrado.' } };
        if (!ESTADOS_ACTIVOS.includes(r.estado)) {
          return { status: 409, body: { error: 'Este reporte ya fue dictaminado.' } };
        }
        if (reclamoVigente(r) && r.asignado_a !== req.usuario.id) {
          return { status: 409, body: { error: 'Otro operador ya tiene este reporte.' } };
        }

        const { rows: mios } = await cliente.query(
          `SELECT reporte_id, estado, asignado_a, asignado_en
           FROM reporte
           WHERE asignado_a = $1 AND reporte_id <> $2 AND estado = ANY($3::text[])`,
          [req.usuario.id, reporteId, ESTADOS_ACTIVOS]
        );
        if (mios.some(reclamoVigente)) {
          return { status: 409, body: { error: 'Ya tienes otro reporte reclamado. Libéralo o dictamínalo primero.' } };
        }

        await cliente.query(
          `UPDATE reporte SET asignado_a = $1, asignado_en = NOW(), estado = 'en_revision' WHERE reporte_id = $2`,
          [req.usuario.id, reporteId]
        );
        const texto = `Unidad enviada: ${tipo_unidad || 'patrulla'} · prioridad ${prioridad || 'media'} · ETA ${eta_minutos || 15} min${comentario ? ' — ' + comentario : ''}`;
        await registrarSeguimiento(cliente, reporteId, req.usuario.id, r.estado, 'en_revision', texto);
        return { status: 200, body: { mensaje: 'Unidad enviada. Reporte reclamado para dictamen.' } };
      });

      if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'enviar-unidad' });
      res.status(resultado.status).json(resultado.body);
    } catch (err) {
      console.error('[PANEL] error al enviar unidad:', err);
      res.status(500).json({ error: 'No se pudo enviar la unidad.' });
    }
  }
);

// ==========================================================================
// 8. Dictaminar (multar o descartar)
// ==========================================================================
router.post(
  '/reportes/:id/dictamen',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  async (req, res) => {
    const reporteId = Number(req.params.id);
    const { resultado: dictamen, monto, comentario } = req.body || {};

    if (!['validado', 'rechazado'].includes(dictamen)) {
      return res.status(400).json({ error: 'Resultado no válido.' });
    }
    const montoNum = dictamen === 'validado' ? Number(monto) : null;
    if (dictamen === 'validado' && !(montoNum > 0)) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }

    try {
      const municipioId = await municipioDe(req.usuario.id);

      const resultado = await conTransaccion(async (cliente) => {
        const r = await bloquearReporte(cliente, reporteId, municipioId);
        if (!r) return { status: 404, body: { error: 'Reporte no encontrado.' } };
        if (!ESTADOS_ACTIVOS.includes(r.estado)) {
          return { status: 409, body: { error: 'Este reporte ya fue dictaminado.' } };
        }
        if (r.asignado_a !== req.usuario.id || !reclamoVigente(r)) {
          return { status: 409, body: { error: 'Tienes que reclamar el reporte (y que el reclamo esté vigente) para dictaminarlo.' } };
        }

        if (dictamen === 'validado') {
          await cliente.query(
            `INSERT INTO multa (reporte_id, autoridad_id, tipo_infraccion_id, monto, estado_pago)
             VALUES ($1, $2, $3, $4, 'pendiente')`,
            [reporteId, req.usuario.id, r.tipo_infraccion_id, montoNum]
          );
        }
        await cliente.query('UPDATE reporte SET estado = $2 WHERE reporte_id = $1', [reporteId, dictamen]);
        await registrarSeguimiento(
          cliente, reporteId, req.usuario.id, r.estado, dictamen,
          comentario || (dictamen === 'validado' ? 'Multa emitida' : 'Reporte descartado')
        );
        return { status: 200, body: { mensaje: 'Dictamen registrado.' } };
      });

      if (resultado.status === 200) emitirCambio({ reporte_id: reporteId, accion: 'dictamen' });
      res.status(resultado.status).json(resultado.body);
    } catch (err) {
      console.error('[PANEL] error en dictamen:', err);
      res.status(500).json({ error: 'No se pudo registrar el dictamen.' });
    }
  }
);

// ==========================================================================
// 9. Tiempo real (SSE)
// ==========================================================================
router.get(
  '/stream',
  verificarToken,
  requerirRol(...ROLES_OPERATIVOS),
  requerirTurnoActivo(pool),
  (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const latido = setInterval(() => res.write(': ping\n\n'), 25000);
    clientesSSE.add(res);
    req.on('close', () => {
      clearInterval(latido);
      clientesSSE.delete(res);
    });
  }
);

module.exports = router;

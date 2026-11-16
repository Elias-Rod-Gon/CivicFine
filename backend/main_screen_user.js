const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { pool } = require('./db');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

const BUCKET = process.env.AWS_S3_BUCKET;
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Genera una URL temporal (1 hora) para ver una foto privada del bucket
async function urlFirmada(key) {
  if (!key) return null;
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 3600 }
  );
}

// ==========================================================================
// Autenticación: toma la identidad del token
// ==========================================================================
function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Sesión requerida.' });
  }

  try {
    req.usuario = jwt.verify(token, SECRET_KEY); // { id, telefono, rol }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

// ==========================================================================
// 1. Lista de reportes del usuario, con miniatura firmada
//    GET /api/usuario/mis-reportes
// ==========================================================================
router.get('/mis-reportes', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.reporte_id AS id, r.fecha_hora, r.direccion, r.placa_detectada,
              r.estado, t.nombre AS tipo_infraccion,
              (SELECT e.url_archivo FROM evidencia e
                WHERE e.reporte_id = r.reporte_id
                ORDER BY e.evidencia_id LIMIT 1) AS evidencia_key
      FROM reporte r
      JOIN tipo_infraccion t ON t.tipo_infraccion_id = r.tipo_infraccion_id
      WHERE r.ciudadano_id = $1
      ORDER BY r.fecha_hora DESC`,
      [req.usuario.id]
    );

    const reportes = await Promise.all(rows.map(async (r) => {
      const evidencia_url = await urlFirmada(r.evidencia_key);
      const { evidencia_key, ...resto } = r;
      return { ...resto, evidencia_url };
    }));

    res.json({ reportes });
  } catch (err) {
    console.error('[MIS-REPORTES] error:', err);
    res.status(500).json({ error: 'No se pudieron cargar los reportes.' });
  }
});

// ==========================================================================
// 2. Detalle de un reporte del usuario, con foto firmada
//    GET /api/usuario/reportes/:id
// ==========================================================================
router.get('/reportes/:id', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.reporte_id, r.fecha_hora, r.direccion, r.latitud, r.longitud,
              r.placa_detectada, r.estado, r.descripcion,
              t.nombre AS tipo_infraccion,
              (SELECT e.url_archivo FROM evidencia e
                WHERE e.reporte_id = r.reporte_id
                ORDER BY e.evidencia_id LIMIT 1) AS evidencia_key
      FROM reporte r
      JOIN tipo_infraccion t ON t.tipo_infraccion_id = r.tipo_infraccion_id
      WHERE r.reporte_id = $1 AND r.ciudadano_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    const reporte = rows[0];
    reporte.evidencia_url = await urlFirmada(reporte.evidencia_key);
    delete reporte.evidencia_key;

    res.json({ reporte });
  } catch (err) {
    console.error('[DETALLE] error:', err);
    res.status(500).json({ error: 'No se pudo obtener el reporte.' });
  }
});

module.exports = router;

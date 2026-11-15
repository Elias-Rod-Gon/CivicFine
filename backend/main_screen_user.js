const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// GET /api/usuario/mis-reportes/:ciudadano_id
router.get('/mis-reportes/:ciudadano_id', async (req, res) => {
  const { ciudadano_id } = req.params;

  if (!ciudadano_id || isNaN(ciudadano_id)) {
    return res.status(400).json({ error: 'ID de ciudadano no válido' });
  }

  try {
    const query = `
      SELECT
        r.reporte_id,
        CONCAT('REP-', EXTRACT(YEAR FROM r.fecha_hora), '-', LPAD(r.reporte_id::text, 6, '0')) AS folio,
        r.fecha_hora,
        r.direccion,
        r.descripcion,
        r.placa_detectada,
        r.estado,
        ti.nombre AS tipo_infraccion,
        m.nombre AS municipio,
        COALESCE(
          (SELECT url_archivo FROM evidencia WHERE reporte_id = r.reporte_id LIMIT 1),
          ''
        ) AS evidencia_url
      FROM reporte r
      JOIN tipo_infraccion ti ON r.tipo_infraccion_id = ti.tipo_infraccion_id
      JOIN municipio m ON r.municipio_id = m.municipio_id
      WHERE r.ciudadano_id = $1
      ORDER BY r.fecha_hora DESC;
    `;

    const result = await pool.query(query, [ciudadano_id]);
    res.json({ reportes: result.rows });

  } catch (error) {
    console.error('Error al obtener el historial de reportes:', error);
    res.status(500).json({ error: 'Error interno al consultar historial' });
  }
});

module.exports = router;

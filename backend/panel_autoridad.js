const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// GET /api/autoridad/reportes?municipio_id=X
router.get('/reportes', async (req, res) => {
  const { municipio_id } = req.query;

  if (!municipio_id || isNaN(municipio_id)) {
    return res.status(400).json({ error: 'Municipio no válido' });
  }

  try {
    const query = `
      SELECT
        r.reporte_id,
        CONCAT('REP-', EXTRACT(YEAR FROM r.fecha_hora), '-', LPAD(r.reporte_id::text, 6, '0')) AS folio,
        r.fecha_hora,
        r.latitud,
        r.longitud,
        r.direccion,
        r.descripcion,
        r.placa_detectada,
        r.estado,
        ti.nombre AS tipo_infraccion,
        ti.monto_referencia,
        m.nombre AS municipio,
        COALESCE(
          (SELECT url_archivo FROM evidencia WHERE reporte_id = r.reporte_id LIMIT 1),
          ''
        ) AS evidencia_url
      FROM reporte r
      JOIN tipo_infraccion ti ON r.tipo_infraccion_id = ti.tipo_infraccion_id
      JOIN municipio m ON r.municipio_id = m.municipio_id
      WHERE r.municipio_id = $1 AND r.estado IN ('pendiente', 'en_revision')
      ORDER BY r.fecha_hora ASC;
    `;

    const result = await pool.query(query, [municipio_id]);
    res.json({ reportes: result.rows });

  } catch (error) {
    console.error('Error al obtener bandeja de autoridad:', error);
    res.status(500).json({ error: 'Error al consultar denuncias' });
  }
});

// PATCH /api/autoridad/reportes/:id/dictamen
router.post('/reportes/:id/dictamen', async (req, res) => {
  const { id } = req.params;
  const { autoridad_id, nuevo_estado, comentario, monto } = req.body;

  if (!['validado', 'rechazado'].includes(nuevo_estado)) {
    return res.status(400).json({ error: 'Estado de dictamen no válido' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Obtener estado actual del reporte
    const repCheck = await client.query(
      'SELECT estado, tipo_infraccion_id FROM reporte WHERE reporte_id = $1',
      [id]
    );

    if (repCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reporte no encontrado' });
    }

    const estadoAnterior = repCheck.rows[0].estado;
    const tipoInfraccionId = repCheck.rows[0].tipo_infraccion_id;

    // 2. Actualizar el estado del reporte
    await client.query(
      'UPDATE reporte SET estado = $1 WHERE reporte_id = $2',
      [nuevo_estado, id]
    );

    // 3. Registrar en seguimiento_reporte (historial de auditoría)
    await client.query(
      `INSERT INTO seguimiento_reporte (reporte_id, autoridad_id, estado_anterior, estado_nuevo, comentario)
      VALUES ($1, $2, $3, $4, $5)`,
      [id, autoridad_id, estadoAnterior, nuevo_estado, comentario || '']
    );

    // 4. Si fue validado, emitir la multa correspondiente
    let multaId = null;
    if (nuevo_estado === 'validado') {
      const resMulta = await client.query(
        `INSERT INTO multa (reporte_id, autoridad_id, tipo_infraccion_id, monto)
        VALUES ($1, $2, $3, $4)
        RETURNING multa_id`,
        [id, autoridad_id, tipoInfraccionId, monto || 1200.00]
      );
      multaId = resMulta.rows[0].multa_id;
    }

    await client.query('COMMIT');
    res.json({
      mensaje: 'Dictamen registrado con éxito',
      reporte_id: id,
      nuevo_estado,
      multa_id: multaId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al dictaminar reporte:', error);
    res.status(500).json({ error: 'Error interno al registrar dictamen' });
  } finally {
    client.release();
  }
});

module.exports = router;

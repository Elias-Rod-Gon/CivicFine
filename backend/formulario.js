const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// GET /api/reportes/catalogos
router.get('/catalogos', async (req, res) => {
  try {
    const municipios = await pool.query('SELECT municipio_id, nombre, estado FROM municipio ORDER BY nombre ASC');
    const infracciones = await pool.query('SELECT tipo_infraccion_id, nombre, descripcion, monto_referencia FROM tipo_infraccion ORDER BY nombre ASC');

    res.json({
      municipios: municipios.rows,
      infracciones: infracciones.rows
    });
  } catch (error) {
    console.error('Error al obtener catálogos:', error);
    res.status(500).json({ error: 'Error al cargar catálogos' });
  }
});

// POST /api/reportes/crear
router.post('/crear', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      ciudadano_id,
      municipio_id,
      tipo_infraccion_id,
      fecha_hora,
      latitud,
      longitud,
      direccion,
      descripcion,
      placa_detectada,
      marca,
      modelo,
      color,
      url_evidencia
    } = req.body;

    if (!ciudadano_id || !municipio_id || !tipo_infraccion_id) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    await client.query('BEGIN');

    // Registrar o actualizar vehículo si se detectó placa
    let vehiculo_id = null;
    if (placa_detectada) {
      const vehiculoRes = await client.query(
        `INSERT INTO vehiculo (placa, marca, modelo, color)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (placa) DO UPDATE SET marca = EXCLUDED.marca, modelo = EXCLUDED.modelo, color = EXCLUDED.color
        RETURNING vehiculo_id`,
        [placa_detectada, marca || null, modelo || null, color || null]
      );
      vehiculo_id = vehiculoRes.rows[0].vehiculo_id;
    }

    // Insertar el reporte principal
    const queryReporte = `
      INSERT INTO reporte (
        ciudadano_id, municipio_id, tipo_infraccion_id, vehiculo_id,
        fecha_hora, latitud, longitud, direccion,
        descripcion, placa_detectada, estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente')
      RETURNING reporte_id;
    `;

    const resReporte = await client.query(queryReporte, [
      ciudadano_id,
      municipio_id,
      tipo_infraccion_id,
      vehiculo_id,
      fecha_hora || new Date(),
      latitud || null,
      longitud || null,
      direccion || '',
      descripcion || '',
      placa_detectada || null
    ]);

    const reporte_id = resReporte.rows[0].reporte_id;

    // Registrar evidencia de la denuncia
    if (url_evidencia) {
      await client.query(
        `INSERT INTO evidencia (reporte_id, tipo, url_archivo) VALUES ($1, 'foto', $2)`,
        [reporte_id, url_evidencia]
      );
    }

    await client.query('COMMIT');

    const folio = `REP-${new Date().getFullYear()}-${String(reporte_id).padStart(6, '0')}`;
    res.status(201).json({ mensaje: 'Reporte registrado exitosamente', reporte_id, folio });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al guardar reporte:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;

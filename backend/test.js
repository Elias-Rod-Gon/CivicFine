const { pool } = require('./db');

async function probarPanelAutoridad() {
  console.log('--- TEST: Módulo panel_autoridad.js ---');

  try {
    // 1. Obtener un reporte pendiente
    const repRes = await pool.query("SELECT reporte_id, municipio_id, tipo_infraccion_id FROM reporte WHERE estado = 'pendiente' LIMIT 1;");
    if (repRes.rows.length === 0) {
      throw new Error('No hay reportes pendientes para dictaminar');
    }

    const { reporte_id, municipio_id } = repRes.rows[0];

    // 2. Crear un usuario de tipo autoridad si no existe
    let autUserRes = await pool.query("SELECT usuario_id FROM usuario WHERE correo = 'oficial@zapopan.gob.mx';");
    let autoridadUserId;

    if (autUserRes.rows.length === 0) {
      const newAutUser = await pool.query(
        `INSERT INTO usuario (nombre, correo, telefono, contrasena, rol, municipio_id)
        VALUES ('Oficial Ramírez', 'oficial@zapopan.gob.mx', '3339998877', 'admin123', 'autoridad', $1)
        RETURNING usuario_id;`,
        [municipio_id]
      );
      autoridadUserId = newAutUser.rows[0].usuario_id;

      await pool.query(
        `INSERT INTO autoridad (usuario_id, numero_empleado, cargo, turno)
        VALUES ($1, 'EMP-9042', 'Agente Vial', 'Matutino');`,
        [autoridadUserId]
      );
    } else {
      autoridadUserId = autUserRes.rows[0].usuario_id;
    }

    // 3. Simular dictamen (Validar reporte #reporte_id y generar multa)
    await pool.query('BEGIN');

    await pool.query("UPDATE reporte SET estado = 'validado' WHERE reporte_id = $1;", [reporte_id]);

    await pool.query(
      `INSERT INTO seguimiento_reporte (reporte_id, autoridad_id, estado_anterior, estado_nuevo, comentario)
      VALUES ($1, $2, 'pendiente', 'validado', 'Evidencia fotográfica clara y legible.');`,
      [reporte_id, autoridadUserId]
    );

    const multaRes = await pool.query(
      `INSERT INTO multa (reporte_id, autoridad_id, tipo_infraccion_id, monto)
      VALUES ($1, $2, (SELECT tipo_infraccion_id FROM reporte WHERE reporte_id = $1), 1200.00)
      RETURNING multa_id, monto, estado_pago;`,
      [reporte_id, autoridadUserId]
    );

    await pool.query('COMMIT');

    console.log('Dictamen y emisión de Multa procesados correctamente!');
    console.log(`Reporte #${reporte_id} cambiado a 'validado'.`);
    console.log('Multa emitida en DB:', multaRes.rows[0]);

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error en test de panel_autoridad:', err.message);
  } finally {
    await pool.end();
  }
}

probarPanelAutoridad();

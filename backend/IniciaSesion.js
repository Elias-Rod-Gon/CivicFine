const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { telefono, correo, contrasena } = req.body;

  if (!telefono && !correo) {
    return res.status(400).json({ error: 'Debes proporcionar un teléfono o correo electrónico' });
  }

  try {
    const result = await pool.query(
      `SELECT u.usuario_id, u.nombre, u.correo, u.telefono, u.contrasena, u.rol, u.municipio_id, u.activo,
              a.numero_empleado, a.cargo, a.turno
      FROM usuario u
      LEFT JOIN autoridad a ON u.usuario_id = a.usuario_id
      WHERE u.telefono = $1 OR u.correo = $2`,
      [telefono || '', correo || '']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no registrado' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(403).json({ error: 'La cuenta se encuentra inactiva' });
    }

    if (contrasena && usuario.contrasena !== contrasena) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await pool.query(
      `INSERT INTO sesion (usuario_id) VALUES ($1)`,
      [usuario.usuario_id]
    );

    res.json({
      mensaje: 'Autenticación exitosa',
      usuario: {
        id: usuario.usuario_id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        telefono: usuario.telefono,
        rol: usuario.rol,
        municipio_id: usuario.municipio_id,
        datos_autoridad: usuario.rol === 'autoridad' ? {
          numero_empleado: usuario.numero_empleado,
          cargo: usuario.cargo,
          turno: usuario.turno
        } : null
      }
    });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).json({ error: 'Error interno en el servidor al autenticar' });
  }
});

module.exports = router;

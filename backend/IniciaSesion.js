const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('./db');
const { TURNOS, enTurno } = require('./turnos');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

function formatearUsuario(fila) {
  const { contrasena, ...resto } = fila;
  return {
    ...resto,
    id: fila.usuario_id,
    municipio_nombre: 'Zapopan Centro'
  };
}

function firmarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.usuario_id,
      telefono: String(usuario.telefono),
      rol: String(usuario.rol || 'ciudadano')
    },
    SECRET_KEY,
    { expiresIn: '7d' }
  );
}

// 1. Verificar si el teléfono ya existe
router.get('/verificar-telefono/:telefono', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM usuario WHERE telefono = $1 LIMIT 1',
      [req.params.telefono]
    );
    res.json({ existe: rows.length > 0 });
  } catch (err) {
    console.error('Error al verificar teléfono:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// 2. Registro de usuario nuevo (siempre ciudadano)
router.post('/registro', async (req, res) => {
  try {
    const { nombre, correo, telefono, contrasena, municipio_id } = req.body;

    if (!nombre || !correo || !telefono || !contrasena) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    const existe = await pool.query(
      'SELECT 1 FROM usuario WHERE telefono = $1 OR correo = $2 LIMIT 1',
      [telefono, correo]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El teléfono o correo ya está registrado.' });
    }

    const hash = await bcrypt.hash(contrasena, 10);

    const insertRes = await pool.query(
      `INSERT INTO usuario (nombre, correo, telefono, contrasena, rol, municipio_id, activo)
      VALUES ($1, $2, $3, $4, 'ciudadano', $5, true)
       RETURNING *`,
      [nombre, correo, telefono, hash, municipio_id || 1]
    );

    const nuevo = insertRes.rows[0];
    res.status(201).json({
      mensaje: 'Usuario registrado correctamente',
      token: firmarToken(nuevo),
      usuario: formatearUsuario(nuevo)
    });
  } catch (err) {
    console.error('Error en /api/auth/registro:', err);
    res.status(500).json({ error: 'No se pudo completar el registro.' });
  }
});

// 3. Inicio de sesión (ciudadano, autoridad y admin, solo con teléfono)
router.post('/login', async (req, res) => {
  try {
    const { telefono, contrasena } = req.body;

    if (!telefono || !contrasena) {
      return res.status(400).json({ error: 'Ingresa teléfono y contraseña.' });
    }

    // Trae el turno si es autoridad (LEFT JOIN: ciudadanos y admins no tienen fila)
    const { rows } = await pool.query(
      `SELECT u.*, a.turno
      FROM usuario u
      LEFT JOIN autoridad a ON a.usuario_id = u.usuario_id
      WHERE u.telefono = $1 AND u.activo = true`,
      [telefono]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
    }

    const fila = rows[0];
    const coincide = await bcrypt.compare(contrasena, fila.contrasena);
    if (!coincide) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
    }

    // Turno: solo se revisa después de validar la contraseña
    if (fila.rol === 'autoridad') {
      if (!fila.turno || !TURNOS[fila.turno]) {
        return res.status(403).json({ error: 'Tu cuenta no tiene un turno válido asignado.' });
      }
      if (!enTurno(fila.turno)) {
        const t = TURNOS[fila.turno];
        return res.status(403).json({
          error: `Tu turno ${fila.turno} es de ${String(t.inicio).padStart(2, '0')}:00 a ${String(t.fin).padStart(2, '0')}:00. Ahora no está activo.`
        });
      }
    }

    res.json({
      token: firmarToken(fila),
      usuario: formatearUsuario(fila)
    });
  } catch (err) {
    console.error('Error en /api/auth/login:', err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('./db');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

// Convierte una fila de la tabla usuario al objeto que consume el frontend
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

// 1. Verificar si el teléfono ya existe en la BD
router.get('/verificar-telefono/:telefono', async (req, res) => {
  try {
    const { telefono } = req.params;
    const check = await pool.query(
      'SELECT 1 FROM usuario WHERE telefono = $1 LIMIT 1',
      [telefono]
    );
    res.json({ existe: check.rows.length > 0 });
  } catch (err) {
    console.error('Error al verificar teléfono:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// 2. Registro de usuario nuevo
router.post('/registro', async (req, res) => {
  try {
    const { nombre, correo, telefono, contrasena, municipio_id } = req.body;

    if (!nombre || !correo || !telefono || !contrasena) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    const checkUser = await pool.query(
      'SELECT 1 FROM usuario WHERE telefono = $1 OR correo = $2 LIMIT 1',
      [telefono, correo]
    );
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: 'El teléfono o correo ya está registrado.' });
    }

    const hash = await bcrypt.hash(contrasena, 10);

    const insertRes = await pool.query(
      `INSERT INTO usuario (nombre, correo, telefono, contrasena, rol, municipio_id, activo)
      VALUES ($1, $2, $3, $4, 'ciudadano', $5, true)
       RETURNING *`,
      [nombre, correo, telefono, hash, municipio_id || 1]
    );

    const nuevoUsuario = insertRes.rows[0];
    const usuario = formatearUsuario(nuevoUsuario);
    const token = firmarToken(nuevoUsuario);

    res.status(201).json({
      mensaje: 'Usuario registrado correctamente',
      token,
      usuario
    });
  } catch (err) {
    console.error('Error en /api/auth/registro:', err);
    res.status(500).json({ error: 'No se pudo completar el registro.' });
  }
});

// 3. Inicio de sesión
router.post('/login', async (req, res) => {
  try {
    const { telefono, contrasena } = req.body;

    if (!telefono || !contrasena) {
      return res.status(400).json({ error: 'Ingresa teléfono y contraseña.' });
    }

    const result = await pool.query(
      'SELECT * FROM usuario WHERE telefono = $1 AND activo = true',
      [telefono]
    );

    // Mismo mensaje para usuario inexistente y contraseña incorrecta
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
    }

    const fila = result.rows[0];
    const coincide = await bcrypt.compare(contrasena, fila.contrasena);

    if (!coincide) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
    }

    const token = firmarToken(fila);

    res.json({
      token,
      usuario: formatearUsuario(fila)
    });
  } catch (err) {
    console.error('Error en /api/auth/login:', err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

module.exports = router;

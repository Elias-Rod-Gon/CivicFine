const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool } = require('./db');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sesión requerida.' });
  try {
    req.usuario = jwt.verify(token, SECRET_KEY);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

// GET /api/perfil: datos actuales del usuario
router.get('/', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.usuario_id AS id, u.nombre, u.telefono, u.correo,
              u.municipio_id, m.nombre AS municipio_nombre
       FROM usuario u
       LEFT JOIN municipio m ON m.municipio_id = u.municipio_id
       WHERE u.usuario_id = $1 AND u.activo = true`,
      [req.usuario.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ usuario: rows[0] });
  } catch (err) {
    console.error('[PERFIL] error:', err);
    res.status(500).json({ error: 'No se pudo cargar el perfil.' });
  }
});

// GET /api/perfil/municipios: lista para el select
router.get('/municipios', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT municipio_id AS id, nombre FROM municipio ORDER BY nombre'
    );
    res.json({ municipios: rows });
  } catch (err) {
    console.error('[MUNICIPIOS] error:', err);
    res.status(500).json({ error: 'No se pudieron cargar los municipios.' });
  }
});

// PUT /api/perfil: nombre, correo y municipio
router.put('/', verificarToken, async (req, res) => {
  try {
    const { nombre, correo, municipio_id } = req.body;
    if (!nombre || !correo) {
      return res.status(400).json({ error: 'Nombre y correo son obligatorios.' });
    }
    const { rows } = await pool.query(
      `UPDATE usuario
       SET nombre = $1, correo = $2, municipio_id = $3
       WHERE usuario_id = $4 AND activo = true
       RETURNING usuario_id AS id, nombre, correo, municipio_id`,
      [nombre.trim(), correo.trim(), municipio_id || null, req.usuario.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ usuario: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ese correo ya está registrado.' });
    }
    console.error('[PERFIL] error al actualizar:', err);
    res.status(500).json({ error: 'No se pudo actualizar el perfil.' });
  }
});

// PUT /api/perfil/contrasena: exige la contraseña actual
router.put('/contrasena', verificarToken, async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva || nueva.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }
    const { rows } = await pool.query(
      'SELECT contrasena FROM usuario WHERE usuario_id = $1 AND activo = true',
      [req.usuario.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const coincide = await bcrypt.compare(actual, rows[0].contrasena);
    if (!coincide) return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });

    const hash = await bcrypt.hash(nueva, 10);
    await pool.query('UPDATE usuario SET contrasena = $1 WHERE usuario_id = $2', [hash, req.usuario.id]);
    res.json({ mensaje: 'Contraseña actualizada.' });
  } catch (err) {
    console.error('[PERFIL] error al cambiar contraseña:', err);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña.' });
  }
});

// DELETE /api/perfil: desactiva la cuenta (no borra filas)
router.delete('/', verificarToken, async (req, res) => {
  try {
    await pool.query('UPDATE usuario SET activo = false WHERE usuario_id = $1', [req.usuario.id]);
    res.json({ mensaje: 'Cuenta desactivada.' });
  } catch (err) {
    console.error('[PERFIL] error al desactivar:', err);
    res.status(500).json({ error: 'No se pudo desactivar la cuenta.' });
  }
});

module.exports = router;

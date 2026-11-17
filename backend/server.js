const express = require('express');
const path = require('path');
require('dotenv').config();

const { pool } = require('./db');
const authRoutes = require('./IniciaSesion');
const formularioRoutes = require('./formulario');
const mainUserRoutes = require('./main_screen_user');
const autoridadRoutes = require('./panel_autoridad');
const perfilRoutes = require('./perfil');
const estadisticasRoutes = require('./estadisticas');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ORIGENES_PERMITIDOS = (process.env.ORIGENES_PERMITIDOS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https:; " +
    "img-src 'self' data: blob: https:; " +
    "frame-src https://www.openstreetmap.org; " +
    "connect-src 'self' https:;"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const origen = req.headers.origin;
  if (origen && (ORIGENES_PERMITIDOS.includes(origen) || !IS_PROD)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, '../Frontend_usuario')));
app.use('/autoridad', express.static(path.join(__dirname, '../frontend_autoridad')));

app.get('/', (req, res) => res.redirect('/IniciaSesion.html'));

app.use('/api/auth', authRoutes);
app.use('/api/reportes', formularioRoutes);
app.use('/api/usuario', mainUserRoutes);
app.use('/api/autoridad', autoridadRoutes);
app.use('/api/perfil', perfilRoutes);
app.use('/api/estadisticas', estadisticasRoutes);

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS ahora');
    res.json({
      status: 'ok',
      entorno: process.env.NODE_ENV || 'development',
      hora_servidor: new Date(),
      hora_base: rows[0].ahora
    });
  } catch (err) {
    console.error('[health] error de base de datos:', {
      codigo: err && err.code,
      mensaje: err && err.message,
      nombre: err && err.name,
      detalle: err
    });
    res.status(503).json({ status: 'error', mensaje: 'Base de datos no disponible.' });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ruta no encontrada.' });
  }
  res.status(404).send('Ruta no encontrada.');
});

app.use((err, req, res, next) => {
  console.error('[servidor] error no controlado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const servidor = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor CivicFine en puerto ${PORT} (entorno: ${process.env.NODE_ENV || 'development'})`);
});

function cerrar(senal) {
  console.log(`${senal} recibido, cerrando servidor.`);
  servidor.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));

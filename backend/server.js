const express = require('express');
const path = require('path');
require('dotenv').config();

const { pool } = require('./db');

// Importar Routers del Backend (Módulos activos)
const authRoutes = require('./IniciaSesion');
const formularioRoutes = require('./formulario');
const mainUserRoutes = require('./main_screen_user');
const autoridadRoutes = require('./panel_autoridad');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para interpretación de JSON y Formularios (Límite 10MB para Base64/imágenes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de Content-Security-Policy y CORS flexible (Local, Cloudflare y Railway)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https: http:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
    "style-src 'self' 'unsafe-inline' https:; " +
    "img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https: http: ws: wss:;"
  );
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const perfilRoutes = require('./perfil');
app.use('/api/perfil', perfilRoutes);

const estadisticasRoutes = require('./estadisticas');
app.use('/api/estadisticas', estadisticasRoutes);
// --------------------------------------------------------------------------
// Archivos Estáticos (Frontend)
// --------------------------------------------------------------------------
// Frontend de Ciudadano (Raíz)
app.use(express.static(path.join(__dirname, '../Frontend_usuario')));

// Panel de Autoridad
app.use('/autoridad', express.static(path.join(__dirname, '../frontend_autoridad')));

// Redirección de la raíz / al login de usuario
app.get('/', (req, res) => {
  res.redirect('/IniciaSesion.html');
});

// --------------------------------------------------------------------------
// Rutas API REST (Endpoints)
// --------------------------------------------------------------------------
app.use('/api/auth', authRoutes);           // Login y Autenticación
app.use('/api/reportes', formularioRoutes); // Formulario, OCR y Reportes
app.use('/api/usuario', mainUserRoutes);    // Historial y Perfil del Ciudadano
app.use('/api/autoridad', autoridadRoutes); // Consola y Dictamen de la Autoridad

// Endpoint de prueba de salud / Base de datos
app.get('/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      serverTime: new Date(),
      dbTime: dbRes.rows[0].now
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manejo de rutas inexistentes (404)
app.use((req, res) => {
  res.status(404).send('Ruta no encontrada en el servidor CivicFine.');
});

// Iniciar servidor Express
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Servidor CivicFine iniciado correctamente`);
  console.log(`📡 Puerto:          ${PORT}`);
  console.log(`📱 Vista Ciudadano: http://localhost:${PORT}/IniciaSesion.html`);
  console.log(`🛡️ Vista Autoridad: http://localhost:${PORT}/autoridad/panel_autoridad.html`);
  console.log('====================================================');
});

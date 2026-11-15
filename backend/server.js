const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir frontend
app.use('/usuario', express.static(path.join(__dirname, '../Frontend_usuario')));
app.use('/autoridad', express.static(path.join(__dirname, '../frontend_autoridad')));

// Endpoint de verificación global (Health check)
app.get('/api/health', (req, res) => {
  res.json({ estado: 'OK', proyecto: 'CivicFine API' });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Servidor CivicFine corriendo en el puerto ${PORT}`);
  });
}

module.exports = app;

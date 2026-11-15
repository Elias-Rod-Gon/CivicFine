const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Conexión flexible: usa DATABASE_URL (Railway) o variables individuales (.env local)
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'elias',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'civicfine',
      ssl: false
    };

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  console.log(`Conexión exitosa a la base de datos PostgreSQL (${poolConfig.database || 'Railway'})`);
});

pool.on('error', (err) => {
  console.error('Error inesperado en PostgreSQL:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};

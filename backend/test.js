const crypto = require('crypto');
const { pool } = require('./db');

function generarHash(dato) {
  return crypto.createHash('sha256').update(dato.trim().toUpperCase()).digest('hex');
}

async function probarHashing() {
  console.log('--- TEST: Hashing SHA-256 en formulario.js ---');

  try {
    const placaOriginal = 'JAL-987-B';
    const placaHash = generarHash(placaOriginal);

    console.log(`📌 Placa Original: "${placaOriginal}"`);
    console.log(`🔒 SHA-256 Hash (${placaHash.length} chars): ${placaHash}`);

    // Insertar vehículo hasheado
    const vehRes = await pool.query(
      `INSERT INTO vehiculo (placa, marca, modelo, color)
      VALUES ($1, $2, $3, 'Negro')
      ON CONFLICT (placa) DO UPDATE SET color = EXCLUDED.color
      RETURNING vehiculo_id, placa;`,
      [placaHash, generarHash('Nissan'), generarHash('Versa')]
    );

    console.log('✅ Vehículo insertado con Hash exitosamente!');
    console.log('🆔 ID Vehículo:', vehRes.rows[0].vehiculo_id);
    console.log('🔑 Hash almacenado en PostgreSQL:', vehRes.rows[0].placa);

  } catch (err) {
    console.error('❌ Error en test de Hashing:', err.message);
  } finally {
    await pool.end();
  }
}

probarHashing();

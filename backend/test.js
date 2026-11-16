// migrar_contrasenas.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./db');

(async () => {
  const { rows } = await pool.query(
    "SELECT usuario_id, contrasena FROM usuario WHERE contrasena NOT LIKE '$2b$%'"
  );
  for (const u of rows) {
    const hash = await bcrypt.hash(u.contrasena, 10);
    await pool.query('UPDATE usuario SET contrasena = $1 WHERE usuario_id = $2', [hash, u.usuario_id]);
  }
  console.log(`Migradas ${rows.length} contraseñas.`);
  process.exit(0);
})();

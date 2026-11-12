const form = document.getElementById("form");
if(form){
form.addEventListener("submit", captura);
}

const telInp = document.getElementById("telefono");
const tel = telInp.value;

const respuesta = document.getElementById("telefono");
const datosUsuario = await respuesta.json();
  console.log('Datos obtenidos del usuario:', datosUsuario);

app.get('/api/buscar-usuario', async (req, res) => {
  const telefono = req.query.tel;

  const usuasrio = await obtenerUsuarioPorTelefono(telefono);
  res.json(usuasrio);
});

async function obtenerUsuarioPorTelefono(telefono) {
  const querry = 'SELECT id, nombre, telefono FROM usuarios WHERE telefono = $1';
  const resultado = await db.querry(querry, [telefono]);
  return resultado.rows[0];
}

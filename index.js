require("dotenv").config();

const express = require("express");
const cookieSession = require("cookie-session");
var cookieParser = require("cookie-parser");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
var path = require("path");
const axios = require("axios");
const {
  getAlumnosFromMetricsJson,
  getOtherMetricsJson,
  getStudentsHours,
} = require("./public/src/functions");
const app = express();

const bcrypt = require("bcrypt");
const saltRounds = 10; // Número de rondas de hashing para generar la sal
const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "qrapids_postgres",
  database: "postgres",
  password: "example",
  port: 5432,
});

/* const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "postgres",
  password: "example",
  port: 5433,
}); */

app.use(cookieParser());
app.use(
  cookieSession({
    maxAge: 24 * 60 * 60 * 1000,
    keys: [process.env.SECRET],
  })
);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

app.use(express.static(__dirname + "/public"));
app.engine("html", require("ejs").renderFile);
app.set("view engine", "ejs");

//Compobación conexión a postgres
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Error al conectar a la base de datos", err.stack);
  } else {
    console.log("Conexión exitosa a la base de datos:", res.rows[0].now);
  }
});

/**
 * Obtiene los nombres de usuario de Taiga y GitHub de los estudiantes asociados a un proyecto.
 *
 * @param {string} project - Identificador externo del proyecto del que se quieren obtener los nombres de usuario.
 * @returns {Array<Object>} - Un array de objetos que contiene los nombres de usuario de Taiga y GitHub de los estudiantes asociados al proyecto
 * @returns {Array<Object>} - Un array de objetos que contiene los nombres de usuario de Taiga y GitHub de los estudiantes asociados al proyecto.
 * Cada objeto tiene dos propiedades: taiga_username y github_username.
 */
async function getUsernamesGitTaiga(project) {
  try {
    const { rows } = await pool.query(
      `SELECT s.taiga_username, s.github_username FROM student s JOIN project p ON (s.projectid = p.id) WHERE p.externalid = $1`,
      [project]
    );
    return rows;
  } catch (error) {
    console.error(error);
  }
}

/* let projectNames = [];

function fetchProjectNames() {
  axios
    .get("http://gessi-dashboard.essi.upc.edu:8888/api/projects")
    .then((response) => {
      projectNames = response.data.map((project) => project.name);
      console.log("Project names updated");
    })
    .catch((error) => console.log(error));
}

fetchProjectNames();
setInterval(fetchProjectNames, 6000000); */

//VARIABLE GLOBAL DONDE SE ALMACENAN LAS MÉTRICAS DE CADA ALUMNO EN CADA PROYECTO.
const metricsByProject = {};

//VARIABLE  GLOBAL DONDE SE ALMACENAN LAS MÉTRICAS GENERALES DEL PROYECTO EN CADA PROYECTO.
const ProjectmetricsByProject = {};

//VARIABLE GLOBAL DONDE SE ALMACENAN LAS HORAS DE DEDICACIÓN DE LOS ALUMNOS EN CADA PROYECTO. (Va por separado porque provienen de un excel y no se puede mapear con los nombres d4e usuario)
const StudentHoursByProject = {};

//VARIABLE GLOBAL DONDE SE GUARDAN LAS FECHAS Y LAS EVALUACIONES PARA HACEL EL COOLDOWN Y QUE NO SE PUEDA SPAMMEAR
const evaluationsByProject = {};

async function initializeProjectsEvaluationRecords() {
  try {
    const response = await axios.get(
      "http://gessi-dashboard.essi.upc.edu:8888/api/projects"
    );
    const projectNames = response.data.map((project) => project.name);

    for (const projectName of projectNames) {
      evaluationsByProject[projectName] = {
        lastReport: "started",
        report: "",
      };
    }
  } catch (error) {
    // Manejar el error de la llamada a la API
    console.error("Error al obtener los proyectos de la API:", error);
    // Puedes agregar aquí el código para manejar el error según tus necesidades
  }
}

// Uso de la función para inicializar los records de evaluaciones
initializeProjectsEvaluationRecords();

/**
 * Hace una llamada a la api y obtiene Todos los proyectos. Luego para cada proyecto hace una llamada para obtener sus metricas. Si falla lo vuelve a intentar hasta 5 veces.
 * Si falla las 5 veces en vez de sobreescribir la variable global se recupera la anterior version guardada en una variable local auxiliar. Siguiente a eso filtra los jsons obtenidos
 * para separarlos por alumno y tipo de métrica para poder hacer el filtro en la aplicación. Como los nombres de usuario de taiga y github pueden ser distintos, se trantan como diferentes
 * alumnos. Por eso luego se hace un mapeo de los nombres y se guardan las métricas de los dos nombres en el de Taiga. Finalmente se guarda todo en la variable global metricsByProject.
 * Las métricas generales del proyecto no hace falta hacer el mapeo, se guardan ates en la variable global ProjectmetricsByProject.
 *
 * @returns {void}
 */
async function fetchProjectMetrics() {
  try {
    //chrome.google.com/webstore/devconsole/3e21e760-8c4b-4f3e-b3bd-defbec249f67/settings
    //Guardar las ultimas métricas por si falla la llamada
    https: var metricsaux = metricsByProject;
    var projectmetricsaux = ProjectmetricsByProject;
    var StudentHoursByProjectaux = StudentHoursByProject;

    //LLamada para obtener los nombres de los proyectos
    const response = await axios.get(
      "http://gessi-dashboard.essi.upc.edu:8888/api/projects"
    );
    const projectNames = response.data.map((project) => project.name);
    console.log("Project names :", projectNames);
    for (const projectName of projectNames) {
      if (!evaluationsByProject.hasOwnProperty(projectName)) {
        evaluationsByProject[projectName] = {
          lastReport: "started",
          report: "",
        };
      }
    }
    //LLamada para obtener las métricas de cada proyecto
    const metricsPromises = projectNames.map(async (projectName) => {
      const link = `http://gessi-dashboard.essi.upc.edu:8888/api/metrics/current?prj=${projectName}`;
      var retry = true;
      var try_number = 0;
      while (retry && try_number < 5) {
        try {
          const response = await axios.get(link);
          retry = false;
          console.log("Loaded metrics of project -> " + projectName);
          return { projectName, data: response.data };
        } catch (error) {
          if (error.response && error.response.status === 400) {
            console.log(`Error 400 for ${link}:`, error.response.data);
            retry = true;
          } else {
            console.log(`Error fetching data for ${link}:`, error.message);
            console.log("Retrying in 5 seconds...");
            //Timeout para esperar 5 segundos a pillar otra vez las métricas del proyecto que ha fallado
            await new Promise((resolve) => setTimeout(resolve, 5000));
            retry = true;
          }
          ++try_number;
        }
      }

      //Si ha fallado 5 veces en las llamadas, recuperar la variable globar anterior
      if (try_number >= 5) {
        console.log(
          "Metrics cannot be fetched, keeping the last saved version of the metrics"
        );
        if (metricsaux[projectName]) {
          metricsByProject[projectName] = metricsaux[projectName];
        }
        if (projectmetricsaux[projectName]) {
          ProjectmetricsByProject[projectName] = projectmetricsaux[projectName];
        }
        if (StudentHoursByProjectaux[projectName]) {
          StudentHoursByProject[projectName] =
            StudentHoursByProjectaux[projectName];
        }
      }
    });

    const metricsResponses = await Promise.all(metricsPromises);
    const metricsData = metricsResponses.filter(
      (response) => response !== undefined
    );

    //Filtrar los datos obtenidos de forma que la aplicación pueda leerlos fácilmente
    metricsData.forEach((response) => {
      const { projectName, data } = response;
      ProjectmetricsByProject[projectName] = getOtherMetricsJson(data);
      metricsByProject[projectName] = getAlumnosFromMetricsJson(data);
      StudentHoursByProject[projectName] = getStudentsHours(data);
    });

    console.log("Metrics by project: loaded");
  } catch (error) {
    console.log(error);
  }
  try {
    //Al filtrar los datos, los nombres de los estudiantes puede ser diferentes en taiga y github. Por eso la funcion de filtrado los trata como diferentes estudiantes.
    //Aqui se obtiene los nombres de usuario y se mapea en uno solo, el de taiga concretamente.
    for (const [nombreProyecto, json] of Object.entries(metricsByProject)) {
      const mapping = await getUsernamesGitTaiga(nombreProyecto);
      const taigaNames = {};

      for (const item of mapping) {
        const taigaName = item.taiga_username;
        const githubName = item.github_username;
        taigaNames[taigaName] = [];
        taigaNames[taigaName] = metricsByProject[nombreProyecto][taigaName];
        if (metricsByProject[nombreProyecto].hasOwnProperty(githubName)) {
          const set = new Set(taigaNames[taigaName]);
          for (const obj of metricsByProject[nombreProyecto][githubName]) {
            if (!set.has(obj)) {
              if (taigaNames[taigaName] == undefined)
                taigaNames[taigaName] = [];
              taigaNames[taigaName].push(obj);
              set.add(obj);
            }
          }
        }
      }
      //Ordena Alfabeticamente
      const objetoOrdenado = {};
      const keys = Object.keys(taigaNames).sort((keyA, keyB) =>
        keyA.localeCompare(keyB)
      );
      for (const key of keys) {
        objetoOrdenado[key] = taigaNames[key];
      }

      //Sobrescribir el JSON actual con el nuevo JSON
      metricsByProject[nombreProyecto] = objetoOrdenado;
    }

    console.log("Usernames from github and taiga of the metrics mapped");
  } catch (error) {
    console.error(error);
    console.log(
      "\n Usernames from github and taiga of the metrics cannot be mapped so it will be treated as separated students due an error in quering postgres database"
    );
  }
}

/*
 * Se llama a la función fetchProjectMetrics() para obtener las métricas de cada proyecto y transformarlas. Es la función más importante.
 */
fetchProjectMetrics();

/*
*
// Se establece un intervalo de tiempo de 24 horas (en milisegundos) para llamar a la función fetchProjectMetrics() de manera periódica.
*/
setInterval(fetchProjectMetrics, 86400000);

//VARIABLE GLOBAL PARA LAS CATEGORIAS
let metricsCategories = {};

/**
 * Hace una llamada a la api y obtiene las catgegorías métricas. Luego pasa a un formato legible para la aplicación y las guarda en la variable global metricsCategories.
 * Pasa de tener todo separado a tener 3 arrays en cada categoría: los valores, los colores y los types (LOW,HIGH..)
 *
 * @returns {void}
 */
async function fetchMetricsCategories() {
  try {
    const response = await axios.get(
      "http://gessi-dashboard.essi.upc.edu:8888/api/metrics/categories"
    );
    const cat = [...new Set(response.data.map((obj) => obj.name))];

    const aux = {};
    for (let name of cat) {
      aux[name] = response.data.filter((obj) => obj.name === name);
    }

    for (var atributo in aux) {
      var valores = aux[atributo]
        .map(function (objeto) {
          return objeto.upperThreshold;
        })
        .reverse();

      valores.unshift(0);

      metricsCategories[atributo] = {
        values: valores,
        colors: aux[atributo]
          .map(function (objeto) {
            return objeto.color;
          })
          .reverse(),
        type: aux[atributo]
          .map(function (objeto) {
            return objeto.type;
          })
          .reverse(),
      };
    }

    console.log("Categories of each project: loaded");
  } catch (error) {
    console.log(error);
  }
}

// Se llama a la función fetchMetricsCategories() para obtener las categorías de métricas.
fetchMetricsCategories();

// Se establece un intervalo de tiempo de 24 horas (en milisegundos) para llamar a la función fetchMetricsCategories() de manera periódica.
setInterval(fetchMetricsCategories, 86400000);

/**
 * Crea un objeto JSON personalizado a partir de los datos proporcionados y el atributo especificado.
 *
 * @param {Object} data - Objeto con los datos de entrada. Es el JSON son las últimas categorías de las métricas guardadas
 * @param {string} attribute - Atributo utilizado para crear el objeto JSON. Es el numero de estudiantes de cada equipo.
 * @returns {Object} - Objeto JSON personalizado.
 */
function createCustomJSON(data, attribute) {
  const customJSON = {};

  if (data[`${attribute} members contribution`]) {
    customJSON.memberscontribution = data[`${attribute} members contribution`];
  }
  if (data[`${attribute} members contributon`]) {
    customJSON.memberscontribution = data[`${attribute} members contributon`];
  }
  if (data.Deviation) {
    customJSON.Deviation = data.Deviation;
  }
  if (data.Default) {
    customJSON.Default = data.Default;
  }
  if (data["Reversed Default"]) {
    customJSON.RDefault = data["Reversed Default"];
  }

  return customJSON;
}

/**
 * Crea una cadena de texto que describe el proyecto de software y las métricas de desempeño de cada miembro del equipo.
 *
 * @param {Object} metrics - Objeto que contiene las métricas de desempeño de cada miembro del equipo.
 * @returns {string} - Cadena de texto que describe el proyecto de software y las métricas de desempeño de cada miembro del equipo.
 */
function createprompt(metrics) {
  const num = Object.keys(metrics).length;
  let prompt = `I have a software project composed by ${num} team members. For management it is used taiga and
  for control version git. I have some metrics of the project for each team member at this moment of the project. `;
  var i = 1;
  var studentString = "";
  for (student in metrics) {
    studentString = `\n${i}. ${student} : `;
    metrics[student].forEach((element) => {
      studentString = studentString + `${element.name} = ${element.value}; `;
    });

    prompt = prompt + studentString;
    ++i;
  }

  prompt =
    prompt +
    "\nDo an evaluation and also mention how each member can improve it's performance";
  //console.log(prompt);
  return prompt;
}

function checkcooldown(projectName) {
  if (evaluationsByProject[projectName].lastReport != "started") {
    const lastEvaluation = new Date(
      evaluationsByProject[projectName].lastReport
    );
    const nextEvaluation = new Date(
      lastEvaluation.getTime() + 5 * 24 * 60 * 60 * 1000
    ); // +5 dies
    const now = new Date();
    console.log(now);
    if (now < nextEvaluation) {
      return false;
    }
  }
  return true;
}

const verificarContraseña = async (
  contraseñaIngresada,
  contraseñaEncriptada
) => {
  try {
    const esCoincidente = await bcrypt.compare(
      contraseñaIngresada,
      contraseñaEncriptada
    );
    return esCoincidente;
  } catch (error) {
    // Manejo de errores
    console.error("Error al verificar la contraseña:", error);
    throw error;
  }
};

/**
 * Obtiene las métricas de los usuarios de un proyecto específico.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get("/api/projects/:projectName/usersmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  if (projectMetrics) {
    res.json(projectMetrics);
  } else {
    console.log("Error");
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

/**
 * Obtiene las métricas de un proyecto específico.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get("/api/projects/:projectName/projectmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = ProjectmetricsByProject[projectName];
  if (projectMetrics) {
    res.json(projectMetrics);
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

/**
 * Obtiene las horas de los alumnos de un proyecto específico.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get("/api/projects/:projectName/hours", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = StudentHoursByProject[projectName];
  if (projectMetrics) {
    res.json(projectMetrics);
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

/**
 * Obtiene las métricas de evaluación de un proyecto específico.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get("/api/projects/:projectName/lastreport", async (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  if (projectMetrics && evaluationsByProject[projectName]) {
    res.json({
      lastEvaluation: evaluationsByProject[projectName].lastReport,
      report: evaluationsByProject[projectName].report,
    });
  } else {
    return res
      .status(404)
      .json({ error: `Project '${projectName}' not found` });
  }
});

/**
 * Obtiene las métricas de evaluación de un proyecto específico.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get(
  "/api/projects/:projectName/evaluate/projectmetrics",
  async (req, res) => {
    const { projectName } = req.params;
    const projectMetrics = metricsByProject[projectName];
    if (projectMetrics && evaluationsByProject[projectName]) {
      if (checkcooldown(projectName)) {
        //Crea el prompt y hace la llamada a la API de OpenAI de ChatGPT
        const promptproj = createprompt(projectMetrics);
        axios
          .post(
            "https://api.openai.com/v1/chat/completions",
            {
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: promptproj }],
            },
            {
              headers: {
                "Content-Type": "application/json",
                Authorization:
                  "Bearer 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",
              },
            }
          )
          .then((response) => {
            res.json(response.data.choices[0].message.content);
            evaluationsByProject[projectName].report =
              response.data.choices[0].message.content;
            evaluationsByProject[projectName].lastReport =
              new Date().toISOString();
          })
          .catch((error) => {
            evaluationsByProject[projectName].lastReport =
              new Date().toISOString();
            res.json({
              error:
                "Erron in evaluation: " + error.response.data.error.message,
            });
          });
        /*  res.json(
        "Based on these metrics, it seems that ArnauRuesga has not been very active in contributing to the project. He has not completed many tasks or closed many tasks, and has not made any commits or modified any lines. He could improve his performance by setting more specific goals for himself and striving to make regular contributions to the project.\n\nDanieru085 has completed a decent number of tasks and closed a fair amount, but his commit rate and modified lines rate could be improved. He could aim to make more frequent commits and strive to make more significant code changes.\n\nDmolinamesa01 has completed a decent number of tasks and closed a high percentage of them, and has also made many commits and modified a large amount of code. However, he should still strive to maintain consistency in his contributions and not burn out too quickly.\n\nJordicolome789 has completed a fair number of tasks but has not closed any, made any commits or modified any lines. They could improve their performance by setting more specific goals and being more proactive in their contributions.\n\nLluisrubio has completed a fair number of tasks and closed a decent percentage of them, but has not made any commits or modified any lines. They could aim to make more frequent contributions through commits and strive to make more significant code changes.\n\nOverall, each team member has room for improvement in their contributions to the project. Some things they can do to improve include setting specific goals, striving for consistency, being proactive in their contributions, and making more significant code changes"
      ); */
      } else
        res.json(
          "This option is not available until 5 days have passed since the last evaluation"
        );
    } else {
      return res
        .status(404)
        .json({ error: `Project '${projectName}' not found` });
    }
  }
);

/**
 * Obtiene las categorías de métricas de un proyecto.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener el nombre del proyecto en el parámetro de ruta ":projectName".
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.get("/api/projects/:projectName/metricscategories", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  //Si los datos guardados internamente no son nulos
  if (metricsCategories && projectMetrics) {
    var result = {};
    metricsByProject;
    //Crea un JSON con sólo las métricas importantes del equipo pasado por parámetro
    result = createCustomJSON(
      metricsCategories,
      Object.keys(projectMetrics).length
    );
    res.json(result);
  } else {
    res.status(404).json({ error: "Categories not found" });
  }
});

/**
 * Maneja la solicitud de inicio de sesión de un usuario.
 *
 * @param {Object} req - El objeto de solicitud HTTP, que debe contener las credenciales del usuario en el cuerpo de la solicitud.
 * @param {Object} res - El objeto de respuesta HTTP.
 * @returns {void}
 */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    // Retrieve the user's record from the database
    const result = await pool.query(
      "SELECT * FROM appuser WHERE username = $1",
      [username]
    );
    const user = result.rows[0];

    // If the user was not found, return an error response
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify the password
    const esCoincidente = await verificarContraseña(password, user.password);
    if (!esCoincidente) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Password is correct, login successful
    res.json({ message: "Login successful", ok: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", (req, res) => {
  res.json({ ok: "Taiga metrics Back-end is operative" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("El servidor está inicializado en el puerto", PORT);
});

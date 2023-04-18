require("dotenv").config();

const cron = require("node-cron");
const express = require("express");
const cookieSession = require("cookie-session");
var cookieParser = require("cookie-parser");
const cors = require("cors");
const passport = require("passport");
const bodyParser = require("body-parser");
const http = require("http");
var path = require("path");
const axios = require("axios");
const {
  getAlumnosFromMetricsJson,
  getOtherMetricsJson,
} = require("./public/src/functions");
const app = express();

const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: "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",
});
const openai = new OpenAIApi(configuration);

const { Pool } = require("pg");
const { lookupService } = require("dns/promises");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "postgres",
  password: "example",
  port: 5433,
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Error al conectar a la base de datos", err.stack);
  } else {
    console.log("Conexión exitosa a la base de datos:", res.rows[0].now);
  }
});

/* pool.query("SELECT * FROM appuser", (error, results) => {
  if (error) {
    throw error;
  }
  console.log(results.rows);
}); */

pool.query(
  "select s.taiga_username, s.github_username from student s join project p on (s.projectid = p.id) where p.externalid='pes11a'",
  (error, results) => {
    if (error) {
      throw error;
    }
    console.log(results.rows);
  }
);

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

//VARIABLES
var metrics = {};

//CANVIAR EL PRIMER GRUP

/* //EVERY NIGHT AT 02:00AM
cron.schedule("0 2 * * *", function () {
  for (let index = 0; index < groups.length; ++index) {
    let groupcode = groups[index];
    setTimeout(() => {
      getMetrics(groupcode);
    }, 3000);
  }
});
 */

async function getUsernamesGitTaiga(project) {
  try {
    const { rows } = await pool.query(
      `SELECT s.taiga_username, s.github_username FROM student s JOIN project p ON (s.projectid = p.id) WHERE p.externalid = $1`,
      [project]
    );
    //console.log(rows);
    // Aquí puedes hacer algo con los resultados de la consulta
    return rows;
  } catch (error) {
    console.error(error);
    // Aquí puedes manejar el error
  }
}

let projectNames = [];

function fetchProjectNames() {
  axios
    .get("http://gessi-dashboard.essi.upc.edu:8888/api/projects")
    .then((response) => {
      projectNames = response.data.map((project) => project.name);
      console.log("Project names updated:", projectNames);
    })
    .catch((error) => console.log(error));
}

fetchProjectNames();
setInterval(fetchProjectNames, 6000000);

async function fetchData(link) {
  try {
    const response = await axios.get(link);
    if (response && response.data) {
      return response.data;
    } else {
      console.log(`No data found for ${link}`);
      return undefined;
    }
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log(`Error 400 for ${link}:`, error.response.data);
    } else {
      console.log(`Error fetching data for ${link}:`, error.message);
    }
    return undefined;
  }
}

const metricsByProject = {};
const ProjectmetricsByProject = {};

async function fetchProjectMetrics() {
  try {
    const response = await axios.get(
      "http://gessi-dashboard.essi.upc.edu:8888/api/projects"
    );
    const projectNames = response.data.map((project) => project.name);
    console.log("Project names:", projectNames);

    const metricsPromises = projectNames.map((projectName) => {
      const link = `http://gessi-dashboard.essi.upc.edu:8888/api/metrics/current?prj=${projectName}`;
      return fetchData(link).then((data) => ({ projectName, data }));
    });

    const metricsResponses = await Promise.all(metricsPromises);
    const metricsData = metricsResponses.filter(
      (response) => response !== undefined
    );

    metricsData.forEach((response) => {
      const { projectName, data } = response;
      ProjectmetricsByProject[projectName] = getOtherMetricsJson(data);
      // console.log(getOtherMetricsJson(data));
      metricsByProject[projectName] = getAlumnosFromMetricsJson(data);
      //  console.log("------------");
      //if (projectName === "pes11a") console.log(metricsByProject[projectName]);
    });
    //console.log(metricsByProject);

    console.log("Metrics by project:loaded");
  } catch (error) {
    console.log(error);
  }
  try {
    for (const [nombreProyecto, json] of Object.entries(metricsByProject)) {
      const mapping = await getUsernamesGitTaiga(nombreProyecto);
      if (nombreProyecto === "pes11a") {
        //console.log(metricsByProject[nombreProyecto]);
        //console.log("----------------------");
      }
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

      // Sobrescribir el JSON actual con el nuevo JSON
      metricsByProject[nombreProyecto] = taigaNames;
    }
    console.log("Transformed");
  } catch (error) {
    console.error(error);
    // Aquí puedes manejar el error
  }
}

fetchProjectMetrics();
setInterval(fetchProjectMetrics, 6000000);

let metricsCategories = {};

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

    console.log("Categories names: loaded", metricsCategories);
  } catch (error) {
    console.log(error);
  }
}

fetchMetricsCategories();
setInterval(fetchMetricsCategories, 6000000);

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

  return customJSON;
}

function createprompt(projectMetrics) {
  const metrics = getAlumnosFromMetricsJson(projectMetrics);
  const num = Object.keys(metrics).length;

  let prompt = `I have a software project composed by ${num} team members. For managemnt it is used taiga and
  for control version git. I have some metrics of the project for each team member at this moment of the project. `;
  var i = 1;
  var studentString = "";
  for (student in metrics) {
    console.log(metrics[student]);
    studentString = `\n${i}. ${student} : hola.`;
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

app.get("/api/projects/:projectName/usersmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  console.log("LLAMADA");
  if (projectMetrics) {
    res.json(projectMetrics);
    //console.log(getAlumnosFromMetricsJson(projectMetrics));
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

app.get("/api/projects/:projectName/projectmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = ProjectmetricsByProject[projectName];
  console.log("LLAMADA2");
  if (projectMetrics) {
    res.json(projectMetrics);
    //console.log(getOtherMetricsJson(projectMetrics));
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

app.get(
  "/api/projects/:projectName/evaluate/projectmetrics",
  async (req, res) => {
    const { projectName } = req.params;
    const projectMetrics = metricsByProject[projectName];
    console.log("LLAMADA2");
    if (projectMetrics) {
      const promptproj = createprompt(projectMetrics);
      /* axios
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
          console.log(response.data.choices[0].message.content);
          res.json(response.data.choices[0].message.content);
        })
        .catch((error) => {
          res.json({error: error.response.data.error});
        }); */
      res.json(
        "Based on these metrics, it seems that ArnauRuesga has not been very active in contributing to the project. He has not completed many tasks or closed many tasks, and has not made any commits or modified any lines. He could improve his performance by setting more specific goals for himself and striving to make regular contributions to the project.\n\nDanieru085 has completed a decent number of tasks and closed a fair amount, but his commit rate and modified lines rate could be improved. He could aim to make more frequent commits and strive to make more significant code changes.\n\nDmolinamesa01 has completed a decent number of tasks and closed a high percentage of them, and has also made many commits and modified a large amount of code. However, he should still strive to maintain consistency in his contributions and not burn out too quickly.\n\nJordicolome789 has completed a fair number of tasks but has not closed any, made any commits or modified any lines. They could improve their performance by setting more specific goals and being more proactive in their contributions.\n\nLluisrubio has completed a fair number of tasks and closed a decent percentage of them, but has not made any commits or modified any lines. They could aim to make more frequent contributions through commits and strive to make more significant code changes.\n\nOverall, each team member has room for improvement in their contributions to the project. Some things they can do to improve include setting specific goals, striving for consistency, being proactive in their contributions, and making more significant code changes"
      );
    } else {
      return res
        .status(404)
        .json({ error: `Project '${projectName}' not found` });
    }
  }
);

app.get("/api/projects/:projectName/metricscategories", (req, res) => {
  console.log("LLAMADA3");
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  if (metricsCategories && projectMetrics) {
    var result = {};
    metricsByProject;
    console.log(Object.keys(projectMetrics).length);
    result = createCustomJSON(
      metricsCategories,
      Object.keys(projectMetrics).length
    );
    console.log(result);
    res.json(result);
  } else {
    res.status(404).json({ error: "Categories not found" });
  }
});

app.post("/login", async (req, res) => {
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

    // Extract the hashed password from the user's record
    const hashedPassword = user.password;

    // Hash the password the user provided using the same algorithm and salt value
    const isMatch = await bcrypt.compare(password, hashedPassword);

    // Compare the resulting hash with the stored hash
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // If the hashes match, the user is authenticated
    res.json({ message: "Login successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

//GET base
app.get("/", function (req, res) {
  res.render("index.html");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("El servidor está inicializado en el puerto", PORT);
});

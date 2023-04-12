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

/* const { Pool } = require("pg");

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

pool.query("SELECT * FROM appuser", (error, results) => {
  if (error) {
    throw error;
  }
  console.log(results.rows);
});
 */
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
      metricsByProject[projectName] = data;
    });

    console.log("Metrics by project:loaded");
  } catch (error) {
    console.log(error);
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

    metricsCategories = {};
    for (let name of cat) {
      metricsCategories[name] = response.data.filter(
        (obj) => obj.name === name
      );
    }
    console.log("Categories names: loaded");
  } catch (error) {
    console.log(error);
  }
}

fetchMetricsCategories();
setInterval(fetchMetricsCategories, 6000000);

app.get("/api/projects/:projectName/usersmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  console.log("LLAMADA");
  if (projectMetrics) {
    res.json(getAlumnosFromMetricsJson(projectMetrics));
    //console.log(getAlumnosFromMetricsJson(projectMetrics));
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

app.get("/api/projects/:projectName/projectmetrics", (req, res) => {
  const { projectName } = req.params;
  const projectMetrics = metricsByProject[projectName];
  console.log("LLAMADA2");
  if (projectMetrics) {
    res.json(getOtherMetricsJson(projectMetrics));
    //console.log(getOtherMetricsJson(projectMetrics));
  } else {
    res.status(404).json({ error: `Project '${projectName}' not found` });
  }
});

app.get("/api/projects/metricscategories", (req, res) => {
  console.log("LLAMADA2");
  if (metricsCategories) {
    res.json(metricsCategories);
  } else {
    res.status(404).json({ error: "Categories not found" });
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

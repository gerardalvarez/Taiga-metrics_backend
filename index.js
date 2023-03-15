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
require("./public/src/auth");

const app = express();

const { Pool } = require("pg");

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

app.use(cookieParser());
app.use(
  cookieSession({
    maxAge: 24 * 60 * 60 * 1000,
    keys: [process.env.SECRET],
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

app.use(express.static(__dirname + "/public"));
app.engine("html", require("ejs").renderFile);
app.set("view engine", "ejs");

//VARIABLES
var metrics = {
  s11a: [],
  s11b: [],
  s11c: [],
  j12a: [],
  j12b: [],
  j12c: [],
  asw12a: [],
  asw12b: [],
  asw12c: [],
  asw12d: [],
  asw12e: [],
  asw13a: [],
  asw13b: [],
  asw13c: [],
};
const groups = [
  "s11a",
  "s11b",
  "s11c",
  "j12a",
  "j12b",
  "j12c",
  "asw12a",
  "asw12b",
  "asw12c",
  "asw12d",
  "asw12e",
  "asw13a",
  "asw13b",
  "asw13c",
];
const groupNames = {
  s11a: "PES - BusCAT",
  s11b: "ElectriCity",
  s11c: "Potus - Pot Manifesto",
  j12a: "PES-Green Wheel",
  j12b: "PES-AirB&Breath",
  j12c: "MeetCAT",
  asw12a: "Hacker News - ASW",
  asw12b: "ASW - Hacker News",
  asw12c: "ASW: HackerNews Clone",
  asw12d: "ASW12D",
  asw12e: "ASW Hacker News Projects",
  asw13a: "ASW-Framework",
  asw13b: "ASW",
  asw13c: "HackerNews ASW",
};
//CANVIAR EL PRIMER GRUP

function getMetrics(groupcode) {
  var result = "";

  console.log("CALLING LEARNING DAHSBOARD API");

  http
    .request(
      "http://gessi-dashboard.essi.upc.edu:8888/api/metrics/current?prj=" +
        groupcode,
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        // Ending the response
        res.on("end", () => {
          result = JSON.parse(data);
          metrics[groupcode] = JSON.parse(data);
        });
      }
    )
    .on("error", (err) => {
      console.log("Error: ", err);
    })
    .end();

  return result;
}

//EVERY NIGHT AT 02:00AM
cron.schedule("0 2 * * *", function () {
  for (let index = 0; index < groups.length; ++index) {
    let groupcode = groups[index];
    setTimeout(() => {
      getMetrics(groupcode);
    }, 3000);
  }
});

function isLoggedIn(req, res, next) {
  if (req.user) {
    next();
  } else res.status(401).send();
}

//GET base
app.get("/", function (req, res) {
  res.render("index.html");
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["email", "profile"],
    prompt: "select_account",
  })
);

app.get(
  "/google/callback",
  passport.authenticate("google", {
    successRedirect: "/authenticated",
    failureRedirect: "/auth/failure",
  })
);

app.get("auth/failure", (req, res) => {
  res.render("error.html");
});

app.get("/authenticated", isLoggedIn, (req, res) => {
  var name = req.user.displayName;
  res.render("auth.html", { name: name });
});

app.get("/logout", function (req, res, next) {
  req.session = null;
  res.render("logout.html");
});

//GET metrics
app.get("/metrics", isLoggedIn, (req, res) => {
  let groupcode = req.query.groupcode;
  console.log("consulting metrics from group: ", groupcode);
  if (groupcode in metrics) {
    res.send({
      metrics: metrics[groupcode],
      groupname: groupNames[groupcode],
    });
  } else res.status(400).send();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("El servidor está inicializado en el puerto", PORT);
});

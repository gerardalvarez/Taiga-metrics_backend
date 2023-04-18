// funciones.js
function funcion1() {
  console.log("Función 1");
}

function funcion2() {
  console.log("Función 2");
}

function getAlumnosFromMetricsJson(metricsJson) {
  const alumnos = [];

  const qualityFactorsOptions = [
    "assignedtasks",
    "closedtasks",
    "commits",
    "modifiedlinescontribution",
  ];

  for (const metric of metricsJson) {
    const { name, qualityFactors } = metric;
    const username = name.substring(0, name.indexOf(" "));

    if (
      qualityFactors.some((factor) => qualityFactorsOptions.includes(factor))
    ) {
      if (!alumnos.some((e) => e === username)) {
        alumnos.push(username);
      }
    }
  }

  const resultado = {};

  alumnos.forEach((id) => {
    resultado[id] = [];
    metricsJson.forEach((dato) => {
      if (dato.name.includes(id)) {
        resultado[id].push(dato);
      }
    });
  });
  delete resultado["'Anonymous'"];

  const objetoOrdenado = {};
  const keys = Object.keys(resultado).sort((keyA, keyB) =>
    keyA.localeCompare(keyB)
  );
  for (const key of keys) {
    objetoOrdenado[key] = resultado[key];
  }
  return objetoOrdenado;
}

function getOtherMetricsJson(metricsJson) {
  const alumnos = [];

  const qualityFactorsOptions = [
    "userstoriesdefinitionquality",
    "taskseffortinformation",
    "globalstandarddeviation",
    "deviationmetrics",
    "commitsdescription",
    "commitstasksrelation",
    "commitsmanagement",
    "unassignedtasks",
    "deviationmetrics",
    "userstoriesdefinitionquality",
  ];

  for (const metric of metricsJson) {
    const { id, qualityFactors } = metric;
    const username = id;

    if (
      qualityFactors.some((factor) => qualityFactorsOptions.includes(factor))
    ) {
      if (!alumnos.some((e) => e.toLowerCase() === username.toLowerCase())) {
        alumnos.push(username);
      }
    }
  }

  const resultado = {};

  alumnos.forEach((id) => {
    resultado[id] = [];
    metricsJson.forEach((dato) => {
      if (dato.id.includes(id)) {
        resultado[id].push(dato);
      }
    });
  });

  const objetoOrdenado = {};
  const keys = Object.keys(resultado).sort((keyA, keyB) =>
    keyA.toLowerCase().localeCompare(keyB.toLowerCase())
  );
  for (const key of keys) {
    objetoOrdenado[key] = resultado[key];
  }
  return objetoOrdenado;
}

module.exports = {
  funcion1,
  funcion2,
  getAlumnosFromMetricsJson,
  getOtherMetricsJson,
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "tanpa-siklus",
      severity: "error",
      comment: "Dependensi melingkar dilarang",
      from: {},
      to: { circular: true }
    },
    {
      name: "shared-tanpa-dependensi-lokal",
      severity: "error",
      comment: "packages/shared harus tetap menjadi lapisan paling bawah",
      from: { path: "^packages/shared" },
      to: { path: "^packages/(storage|runtime|cli)" }
    },
    {
      name: "storage-tanpa-runtime",
      severity: "error",
      comment: "storage tidak boleh mengimpor runtime atau cli",
      from: { path: "^packages/storage" },
      to: { path: "^packages/(runtime|cli)" }
    },
    {
      name: "runtime-tanpa-cli",
      severity: "error",
      comment: "runtime tidak boleh mengimpor cli",
      from: { path: "^packages/runtime" },
      to: { path: "^packages/cli" }
    },
    {
      name: "tanpa-import-relatif-lintas-paket",
      severity: "error",
      comment: "paket harus berkomunikasi lewat nama paket, bukan path relatif",
      from: { path: "^packages/([^/]+)/" },
      to: { path: "^packages/", pathNot: "^packages/$1/" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|node_modules)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" }
  }
};

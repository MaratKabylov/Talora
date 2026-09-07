const ts = require("typescript"); // eslint-disable-line @typescript-eslint/no-require-imports
module.exports = function (source) {
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: this.resourcePath }).outputText;
};

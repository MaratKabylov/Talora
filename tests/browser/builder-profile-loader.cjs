const ts = require("typescript"); // eslint-disable-line @typescript-eslint/no-require-imports
// Test-only instrumentation: no profiler/probe is shipped in the application bundle.
module.exports = function (source) {
  const identities = { TestBuilderEditor: '"root"', SectionEditor: "currentSection.id",
    QuestionEditor: "currentQuestion.id", OptionEditor: "currentOption.id" };
  const expression = text => {
    const node = ts.createSourceFile("expression.ts", text, ts.ScriptTarget.Latest, true).statements[0].expression;
    const synthesize = child => { ts.setTextRange(child, { pos: -1, end: -1 }); ts.forEachChild(child, synthesize); };
    synthesize(node); return node;
  };
  return ts.transpileModule(source, { fileName: this.resourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [context => root => {
      const visit = node => {
        if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && identities[node.name?.text]) {
          const name = node.name.text;
          const identity = `"${name}:" + ${identities[name]}`;
          const statements = node.body.statements.map(statement => ts.isReturnStatement(statement) && statement.expression
            ? ts.factory.updateReturnStatement(statement, ts.factory.createCallExpression(
                expression('require("react").createElement'), undefined,
                [expression('require("react").Profiler'), expression(`({id: ${identity}, onRender: globalThis.__builderProfile})`), statement.expression]))
            : statement);
          statements.unshift(ts.factory.createExpressionStatement(expression(`globalThis.__builderRenderProbe?.(${identity})`)));
          const body = ts.factory.updateBlock(node.body, statements);
          return ts.isFunctionDeclaration(node)
            ? ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body)
            : ts.factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit);
    }] },
  }).outputText;
};

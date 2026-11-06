const sharing = {
  license: "MIT",
  attribution: "EruSentia test fixture",
  permissionConfirmed: true,
};
const example = structuredClone(
  require("../tools/examples/create-template.json"),
);
example.contentJson.sharing = sharing;
module.exports = { sharing, example };

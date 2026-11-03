const test = require("node:test");
const { contract } = require("./templates.contract.cjs");

test("Template HTTP contract with in-memory persistence (no database)", async (t) => {
  await contract(t, "memory");
});

const test = require("node:test");
const { authContract } = require("./auth.contract.cjs");
test("Authentication, authorization and token rotation with memory persistence", async (t) => {
  await authContract(t, "memory");
});

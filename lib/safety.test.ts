import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChecks, verdictFromChecks, reportFromInputs, type VerdictInputs } from "@/lib/safety";

const clean: VerdictInputs = {
  pumpOrigin: true,
  provenanceIncomplete: false,
  mintRevoked: true,
  freezeRevoked: true,
  authoritiesIncomplete: false,
  earlyBuyerCapture: 0.05,
  top10ExCurve: 0.1,
  holdersIncomplete: false,
  fundingClusterSize: 0,
  fundingIncomplete: false,
  rugcheckScore: 10,
  rugged: false,
  liquidityUsd: 30_000,
};

test("a clean token is GREEN", () => {
  const v = verdictFromChecks(buildChecks(clean));
  assert.equal(v, "GREEN");
});

test("mint authority not revoked is a RED hard-fail", () => {
  const checks = buildChecks({ ...clean, mintRevoked: false });
  assert.equal(verdictFromChecks(checks), "RED");
  const mint = checks.find((c) => c.key === "mint");
  assert.ok(mint?.hardFail);
});

test("freeze authority not revoked is a RED hard-fail", () => {
  assert.equal(verdictFromChecks(buildChecks({ ...clean, freezeRevoked: false })), "RED");
});

test("top-10 concentration over the red threshold hard-fails", () => {
  assert.equal(verdictFromChecks(buildChecks({ ...clean, top10ExCurve: 0.4 })), "RED");
  // elevated-but-under-red is YELLOW
  assert.equal(verdictFromChecks(buildChecks({ ...clean, top10ExCurve: 0.25 })), "YELLOW");
});

test("bundled early-buyer capture over red threshold hard-fails", () => {
  assert.equal(verdictFromChecks(buildChecks({ ...clean, earlyBuyerCapture: 0.3 })), "RED");
  assert.equal(verdictFromChecks(buildChecks({ ...clean, earlyBuyerCapture: 0.18 })), "YELLOW");
});

test("a shared-funding cluster of 3+ hard-fails", () => {
  assert.equal(verdictFromChecks(buildChecks({ ...clean, fundingClusterSize: 3 })), "RED");
  assert.equal(verdictFromChecks(buildChecks({ ...clean, fundingClusterSize: 2 })), "YELLOW");
});

test("rugcheck rugged flag hard-fails", () => {
  assert.equal(verdictFromChecks(buildChecks({ ...clean, rugged: true })), "RED");
});

test("incomplete authority read degrades to YELLOW, not a false GREEN", () => {
  const checks = buildChecks({
    ...clean,
    mintRevoked: undefined,
    freezeRevoked: undefined,
    authoritiesIncomplete: true,
  });
  assert.equal(verdictFromChecks(checks), "YELLOW");
});

test("non-pump provenance cannot pass the LP check on its own", () => {
  const checks = buildChecks({ ...clean, pumpOrigin: false, provenanceIncomplete: false });
  const lp = checks.find((c) => c.key === "lp");
  assert.equal(lp?.verdict, "YELLOW");
});

test("reportFromInputs carries reasons + incomplete flag", () => {
  const report = reportFromInputs("So11111111111111111111111111111111111111112", {
    ...clean,
    mintRevoked: false,
  });
  assert.equal(report.verdict, "RED");
  assert.ok(report.reasons.length >= 1);
  assert.equal(report.incomplete, false);
});

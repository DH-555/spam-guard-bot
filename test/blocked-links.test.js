import test from "node:test";
import assert from "node:assert/strict";
import { findBlockedLink } from "../src/blocked-links.js";

test("detects the blocked SurveyBuilder link in message text", () => {
  assert.ok(findBlockedLink("Mira esto: https://surveybuilder.io/c/capture/MHNKQThUS3A"));
  assert.ok(findBlockedLink("https://SURVEYBUILDER.IO/c/capture/mhnkqthus3a?ref=discord"));
});

test("does not block unrelated SurveyBuilder links", () => {
  assert.equal(findBlockedLink("https://surveybuilder.io/c/capture/other-form"), null);
});

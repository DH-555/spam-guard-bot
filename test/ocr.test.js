import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OCR_EFFORT,
  OCR_EFFORTS,
  normalizeOcrEffort,
} from "../src/ocr.js";

test("defaults OCR effort to high", () => {
  assert.equal(DEFAULT_OCR_EFFORT, OCR_EFFORTS.HIGH);
  assert.equal(normalizeOcrEffort(), OCR_EFFORTS.HIGH);
  assert.equal(normalizeOcrEffort("invalid"), OCR_EFFORTS.HIGH);
});

test("normalizes configured OCR effort", () => {
  assert.equal(normalizeOcrEffort("LOW"), OCR_EFFORTS.LOW);
  assert.equal(normalizeOcrEffort(" medium "), OCR_EFFORTS.MEDIUM);
  assert.equal(normalizeOcrEffort("high"), OCR_EFFORTS.HIGH);
});

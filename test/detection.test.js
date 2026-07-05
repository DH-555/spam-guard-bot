import test from "node:test";
import assert from "node:assert/strict";
import {
  containsScamPhrase,
  DEFAULT_PARANOIA_LEVEL,
  PARANOIA_LEVELS,
  normalizeOcrText,
  normalizeParanoiaLevel,
  truncateText,
} from "../src/detection.js";

test("detects Withdrawal and Success regardless of case or line breaks", () => {
  assert.equal(containsScamPhrase("Withdrawal\nSUCCESS"), true);
});

test("defaults paranoia to high", () => {
  assert.equal(DEFAULT_PARANOIA_LEVEL, PARANOIA_LEVELS.HIGH);
  assert.equal(normalizeParanoiaLevel(), PARANOIA_LEVELS.HIGH);
  assert.equal(normalizeParanoiaLevel("invalid"), PARANOIA_LEVELS.HIGH);
});

test("detects the words when they appear in reverse order", () => {
  assert.equal(containsScamPhrase("Success confirmed: withdrawal complete"), true);
});

test("detects supported success status variants", () => {
  assert.equal(containsScamPhrase("Withdrawal\nSucceeded"), true);
  assert.equal(containsScamPhrase("Successful payment\nWithdrawal"), true);
  assert.equal(containsScamPhrase("Withdrawal\nSuccess!"), true);
  assert.equal(containsScamPhrase("Withdrawal\nSuccessfully!"), true);
  assert.equal(containsScamPhrase("Withdrawal\nUSDT"), true);
  assert.equal(
    containsScamPhrase("Withdrawal\nAmount\nCompleted\nTransfer"),
    true,
  );
});

test("requires all OCR keywords at medium paranoia", () => {
  assert.equal(
    containsScamPhrase("Withdrawal\nSucceeded", PARANOIA_LEVELS.MEDIUM),
    false,
  );
  assert.equal(
    containsScamPhrase("Withdrawal\nSucceeded\nUSDT", PARANOIA_LEVELS.MEDIUM),
    true,
  );
});

test("treats low paranoia as hash only", () => {
  assert.equal(
    containsScamPhrase("Withdrawal\nSUCCESS", PARANOIA_LEVELS.LOW),
    false,
  );
});

test("allows the required keywords to be far apart", () => {
  assert.equal(
    containsScamPhrase(
      `Withdrawal
      Transaction ID: 123456789
      Network: Example
      Amount: 500.00
      Date: 2026-06-19
      Status: Succeeded`,
    ),
    true,
  );
});

test("requires a withdrawal keyword and a complete success keyword", () => {
  assert.equal(containsScamPhrase("Withdrawal pending"), false);
  assert.equal(containsScamPhrase("Succeeded deposit"), false);
  assert.equal(containsScamPhrase("Withdrawal unsuccessfully"), false);
  assert.equal(containsScamPhrase("Withdrawal USDC"), false);
  assert.equal(containsScamPhrase("USDT"), false);
  assert.equal(containsScamPhrase("Withdrawal usdt"), false);
});

test("supports extreme paranoia triggers", () => {
  assert.equal(containsScamPhrase("succs", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("TRX", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("money", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("mr beast", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("cryptocurrency", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("casino!", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("giveaway", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("giving away", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("bets", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("bonus", PARANOIA_LEVELS.EXTREME), true);
  assert.equal(containsScamPhrase("bonuses", PARANOIA_LEVELS.EXTREME), true);
});

test("normalizes OCR text", () => {
  assert.equal(normalizeOcrText("Succéss"), "SUCCESS");
});

test("limits the text included in the moderation alert", () => {
  assert.equal(truncateText(" a \n b "), "a b");
  assert.equal(truncateText("123456", 5), "1234…");
});

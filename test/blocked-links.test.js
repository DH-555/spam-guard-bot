import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKED_DOMAINS,
  findBlockedDomain,
  findBlockedLink,
} from "../src/blocked-links.js";

test("detects the blocked SurveyBuilder link in message text", () => {
  assert.ok(findBlockedLink("Mira esto: https://surveybuilder.io/c/capture/MHNKQThUS3A"));
  assert.ok(findBlockedLink("https://SURVEYBUILDER.IO/c/capture/mhnkqthus3a?ref=discord"));
});

test("detects the blocked Upwork profile and AgentRouter referral links", () => {
  assert.equal(
    findBlockedLink("https://www.upwork.com/freelancers/~011c10fca307bf0e02?mp_source=share"),
    "https://www.upwork.com/freelancers/~011c10fca307bf0e02?mp_source=share",
  );
  assert.equal(
    findBlockedLink("https://agentrouter.org/register?aff=QaiK"),
    "https://agentrouter.org/register?aff=QaiK",
  );
});

test("does not block unrelated SurveyBuilder links", () => {
  assert.equal(findBlockedLink("https://surveybuilder.io/c/capture/other-form"), null);
});

test("detects the blocked Telegram links", () => {
  for (const username of ["SJDIJOG", "SDITRIVDK", "SFIOSGK"]) {
    assert.equal(findBlockedLink(`https://t.me/${username}`), `https://t.me/${username}`);
  }
});

test("detects blocked domains and their subdomains", () => {
  assert.ok(findBlockedLink("https://zangi.com"));
  assert.ok(findBlockedLink("https://www.zangi.com/download"));
  assert.ok(findBlockedLink("http://support.eu.zangi.com:8080/help"));
});

test("does not block domains that only contain a blocked domain as a suffix", () => {
  assert.equal(findBlockedLink("https://notzangi.com"), null);
  assert.equal(findBlockedLink("https://zangi.com.example.org"), null);
});

test("uses the global blocked domain list for OCR text", () => {
  for (const domain of BLOCKED_DOMAINS) {
    assert.equal(findBlockedDomain(domain), domain);
  }

  assert.equal(findBlockedDomain("WENOWIN.COM."), "wenowin.com");
  assert.equal(findBlockedDomain("https://www.ketsowin.com/promo"), "ketsowin.com");
  assert.equal(findBlockedDomain("bogamb . at"), "bogamb.at");
  assert.equal(findBlockedDomain("notwenowin.com"), null);
  assert.equal(findBlockedDomain("wenowin.com.example"), null);
  assert.equal(findBlockedLink("Visita wenowin.com"), "wenowin.com");
});

test("recognizes blocked domains when OCR inserts spaces into the hostname", () => {
  assert.equal(findBlockedDomain("we nowin.com"), "wenowin.com");
  assert.equal(findBlockedDomain("wenowin com"), "wenowin.com");
  assert.equal(findBlockedDomain("wenowin . com"), "wenowin.com");
});

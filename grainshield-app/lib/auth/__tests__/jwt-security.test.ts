import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../jwt.ts";

const TEST_SECRET = "super-secret-cryptographic-test-key-minimum-32-bytes";
const WRONG_SECRET = "another-secret-cryptographic-test-key-minimum-32";

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

test("JWT Security: valid token signed with matching secret is accepted", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const token = await signToken("farmer-123", ["farmer"], 3600);

  const claims = await verifyToken(token);
  assert.ok(claims !== null, "Valid token should be accepted");
  assert.strictEqual(claims?.sub, "farmer-123");
  assert.deepStrictEqual(claims?.roles, ["farmer"]);
});

test("JWT Security: forged token with modified signature is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const token = await signToken("farmer-123", ["farmer"], 3600);
  const parts = token.split(".");
  const forgedSignature = parts[2].slice(0, -4) + "XXXX";
  const forgedToken = `${parts[0]}.${parts[1]}.${forgedSignature}`;

  const claims = await verifyToken(forgedToken);
  assert.strictEqual(claims, null, "Forged token signature must be rejected");
});

test("JWT Security: unsigned token with missing signature is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const token = await signToken("farmer-123", ["farmer"], 3600);
  const parts = token.split(".");
  const unsignedToken = `${parts[0]}.${parts[1]}.`;

  const claims = await verifyToken(unsignedToken);
  assert.strictEqual(claims, null, "Unsigned token must be rejected");
});

test("JWT Security: token with truncated format is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const token = await signToken("farmer-123", ["farmer"], 3600);
  const parts = token.split(".");
  const truncatedToken = `${parts[0]}.${parts[1]}`;

  const claims = await verifyToken(truncatedToken);
  assert.strictEqual(claims, null, "Token without 3 segments must be rejected");
});

test("JWT Security: token signed with wrong secret is rejected", async () => {
  process.env.JWT_SECRET = WRONG_SECRET;
  const tokenWithWrongSecret = await signToken("farmer-123", ["farmer"], 3600);

  process.env.JWT_SECRET = TEST_SECRET;
  const claims = await verifyToken(tokenWithWrongSecret);
  assert.strictEqual(claims, null, "Token signed with incorrect secret must be rejected");
});

test("JWT Security: token with 'alg: none' is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "admin-attacker",
      roles: ["admin"],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: "grainshield",
      jti: "test-jti-none",
    }),
  );

  const noneTokenNoSig = `${header}.${payload}.`;
  const claimsNoSig = await verifyToken(noneTokenNoSig);
  assert.strictEqual(claimsNoSig, null, "alg none without signature must be rejected");

  const noneTokenDummySig = `${header}.${payload}.eW9sbw`;
  const claimsDummySig = await verifyToken(noneTokenDummySig);
  assert.strictEqual(claimsDummySig, null, "alg none with dummy signature must be rejected");
});

test("JWT Security: token with unexpected algorithm is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const header = base64url(JSON.stringify({ alg: "HS384", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "admin-attacker",
      roles: ["admin"],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: "grainshield",
      jti: "test-jti-hs384",
    }),
  );

  const invalidAlgToken = `${header}.${payload}.dummy-signature`;
  const claims = await verifyToken(invalidAlgToken);
  assert.strictEqual(claims, null, "Unsupported algorithm must be rejected");
});

test("JWT Security: expired token is rejected", async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  const expiredToken = await signToken("farmer-123", ["farmer"], -60);

  const claims = await verifyToken(expiredToken);
  assert.strictEqual(claims, null, "Expired token must be rejected");
});

test("JWT Security: missing JWT_SECRET fails closed", async () => {
  delete process.env.JWT_SECRET;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: "123" }));
  const token = `${header}.${payload}.dummy`;

  const claims = await verifyToken(token);
  assert.strictEqual(claims, null, "Missing JWT_SECRET must fail closed and return null");
});

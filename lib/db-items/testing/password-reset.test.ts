import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import {
  createApiTokenForUser,
  findUserIdByApiToken,
  isCurrentCredentialVersion,
  reservePasswordReset,
  resetPasswordWithCode,
  verifyUserCredentials,
} from "../sql/user"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("operator password recovery (DB)", { skip: !testDbUrl }, () => {
  after(async () => getDb().end())

  test("resets a username-only account once and revokes old credentials", async () => {
    const username = `reset-${randomUUID()}`
    const otherUsername = `reset-${randomUUID()}`
    const anonymousUsername = `reset-${randomUUID()}`
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1 (username, password, is_anonymous)
       VALUES ($1, 'old password', false), ($2, 'other password', false), ($3, 'anonymous password', true)
       RETURNING id`,
      [username, otherUsername, anonymousUsername],
    )
    const userId = rows[0]!.id
    try {
      const verified = await verifyUserCredentials(username, "old password")
      assert.equal(verified?.credentialVersion, 0)
      const token = await createApiTokenForUser(userId, 0)
      assert.ok(token)
      assert.equal(await findUserIdByApiToken(token), userId)

      assert.equal(await reservePasswordReset(anonymousUsername, randomUUID()), null)
      assert.equal(await reservePasswordReset("missing-user", randomUUID()), null)
      const reference = randomUUID()
      const delivery = await reservePasswordReset(username.toUpperCase(), reference)
      assert.ok(delivery)
      assert.match(delivery.code, /^[0-9a-f]{32}$/)
      assert.equal(delivery.username, username)
      assert.equal(await reservePasswordReset(username, randomUUID()), null)

      const otherReference = randomUUID()
      const otherDelivery = await reservePasswordReset(otherUsername, otherReference)
      assert.ok(otherDelivery)
      assert.equal(
        await resetPasswordWithCode(otherReference, delivery.code, "new password"),
        false,
      )
      await getDb().query(
        "UPDATE public.user_password_reset_v1 SET requested_at = now() - interval '31 minutes' WHERE request_id = $1",
        [otherReference],
      )
      assert.equal(
        await resetPasswordWithCode(otherReference, otherDelivery.code, "new password"),
        false,
      )

      const results = await Promise.all([
        resetPasswordWithCode(reference, delivery.code, "new password"),
        resetPasswordWithCode(reference, delivery.code, "new password"),
      ])
      assert.deepEqual(results.sort(), [false, true])
      assert.equal(await resetPasswordWithCode(reference, delivery.code, "new password"), false)
      assert.equal(await verifyUserCredentials(username, "old password"), null)
      assert.equal((await verifyUserCredentials(username, "new password"))?.credentialVersion, 1)
      assert.equal(await isCurrentCredentialVersion(userId, 0), false)
      assert.equal(await isCurrentCredentialVersion(userId, 1), true)
      assert.equal(await findUserIdByApiToken(token), null)
      assert.equal(await createApiTokenForUser(userId, 0), null)
      assert.ok(await createApiTokenForUser(userId, 1))
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id = ANY($1::integer[])", [
        rows.map(({ id }) => id),
      ])
    }
  })

  test("caps concurrent sends to the shared recipient", async () => {
    const usernames = Array.from({ length: 6 }, () => `reset-${randomUUID()}`)
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1 (username, password)
       SELECT unnest($1::text[]), 'old password' RETURNING id`,
      [usernames],
    )
    try {
      const attempts = await Promise.all(
        usernames.map((username) => reservePasswordReset(username, randomUUID())),
      )
      assert.equal(attempts.filter(Boolean).length, 5)
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id = ANY($1::integer[])", [
        rows.map(({ id }) => id),
      ])
    }
  })
})

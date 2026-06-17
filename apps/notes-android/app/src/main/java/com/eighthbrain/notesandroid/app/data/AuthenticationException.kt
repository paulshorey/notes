package com.eighthbrain.notesandroid.app.data

/**
 * Thrown when the server rejects a request with HTTP 401 (missing/expired/invalid
 * bearer token, or invalid sign-in credentials). The repository treats this
 * distinctly from generic errors: a saved session is cleared so the app and the
 * widget surface the sign-in UI, instead of leaving the user on a stale screen.
 */
class AuthenticationException(
    message: String,
) : Exception(message)

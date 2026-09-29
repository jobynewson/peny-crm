// src/api/me.js
// Who you are in Slate: your app_users row, which the server creates on your
// first sign-in (api/me.js). A client's account is never given one: the call
// throws with code 'portal_account'.

import { request } from './http.js'

export const getSlateUser = () => request('/api/me', { method: 'POST' }).then(r => r.user)

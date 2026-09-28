// src/utils/landing.js
// Who gets the Slate app and who gets the client portal.
//
// Clients and staff share one Clerk instance. A client is a member of their
// company's Clerk organization; Peny staff are Slate users (an app_users row)
// and belong to no client org. So a signed-in account that belongs to any
// organization and isn't already a Slate user is a client: it goes to the
// portal and never gets an app_users row. A Slate user who has been added to a
// client's org (to see what they see) keeps the app.
export function landingFor({ orgCount, isStaff }) {
  return orgCount > 0 && !isStaff ? 'portal' : 'app'
}

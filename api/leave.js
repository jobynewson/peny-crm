// api/leave.js
// Email-based leave request approval/decline without login
// GET ?token=xxx&action=approve|decline

import { neon } from '@neondatabase/serverless'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { token, action } = req.query

  if (!token) {
    return res.status(400).json({ error: 'Missing approval token' })
  }

  if (!action || !['approve', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const sql = neon(process.env.VITE_DATABASE_URL)

  try {
    // Find the leave request by token
    const requests = await sql`
      SELECT r.*, u.name AS requester_name
      FROM leave_requests r
      JOIN app_users u ON u.id = r.requester_id
      WHERE r.approval_token = ${token} AND r.status = 'pending'
      LIMIT 1
    `

    if (!requests.length) {
      return res.status(404).html(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Request Not Found</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #dc2626; }
            p { margin: 12px 0 0; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Request not found</h1>
            <p>This leave request has already been processed or the link is invalid.</p>
          </div>
        </body>
        </html>
      `)
    }

    const request = requests[0]

    if (action === 'approve') {
      // Update status to approved
      await sql`
        UPDATE leave_requests
        SET status = 'approved', decided_by = ${request.approver_id}, decided_at = NOW()
        WHERE id = ${request.id}
      `

      // Create calendar entry
      const LEAVE_TYPES = {
        holiday: { label: 'Annual leave', color: '#0891b2' },
        sick: { label: 'Sickness', color: '#dc2626' },
        unpaid: { label: 'Unpaid leave', color: '#6b7280' },
        other: { label: 'Other', color: '#7c3aed' },
      }
      const t = LEAVE_TYPES[request.leave_type] || LEAVE_TYPES.other

      const calEntries = await sql`
        INSERT INTO team_calendar_entries (user_id, assignee_id, entry_date, end_date, entry_type, label, color, notes)
        VALUES (
          ${request.user_id},
          ${request.requester_id},
          ${request.start_date},
          ${request.start_date === request.end_date ? null : request.end_date},
          'leave',
          ${t.label},
          ${t.color},
          ${request.reason || null}
        )
        RETURNING id
      `

      // Link calendar entry to leave request
      await sql`
        UPDATE leave_requests
        SET calendar_entry_id = ${calEntries[0].id}
        WHERE id = ${request.id}
      `

      return res.status(200).html(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Approved</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #16a34a; }
            p { margin: 12px 0 0; color: #666; }
            .details { margin: 24px 0; padding: 16px; background: #f9f9f9; border-radius: 8px; text-align: left; font-size: 14px; }
            .details div { margin: 8px 0; }
            .label { color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Leave Approved</h1>
            <div class="details">
              <div><span class="label">Requester:</span> ${request.requester_name}</div>
              <div><span class="label">Dates:</span> ${new Date(request.start_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${new Date(request.end_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <p>The leave request has been approved.</p>
          </div>
        </body>
        </html>
      `)
    } else {
      // Decline
      await sql`
        UPDATE leave_requests
        SET status = 'declined', decided_by = ${request.approver_id}, decided_at = NOW()
        WHERE id = ${request.id}
      `

      return res.status(200).html(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Declined</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #dc2626; }
            p { margin: 12px 0 0; color: #666; }
            .details { margin: 24px 0; padding: 16px; background: #f9f9f9; border-radius: 8px; text-align: left; font-size: 14px; }
            .details div { margin: 8px 0; }
            .label { color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Leave Declined</h1>
            <div class="details">
              <div><span class="label">Requester:</span> ${request.requester_name}</div>
              <div><span class="label">Dates:</span> ${new Date(request.start_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${new Date(request.end_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <p>The leave request has been declined.</p>
          </div>
        </body>
        </html>
      `)
    }
  } catch (err) {
    console.error('Leave approval error:', err)
    return res.status(500).html(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Error</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
          .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
          h1 { margin: 0; color: #dc2626; }
          p { margin: 12px 0 0; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Error</h1>
          <p>An error occurred while processing your request. Please try again.</p>
        </div>
      </body>
      </html>
    `)
  }
}
